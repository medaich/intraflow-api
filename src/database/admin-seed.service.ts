import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User, UserRole } from "../users/entities/user.entity";
import { AuthService } from "../auth/auth.service";

@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const adminCount = await this.usersRepo.count({
      where: { role: UserRole.ADMIN },
    });

    if (adminCount > 0) {
      return;
    }

    const email = this.configService.get<string>("ADMIN_EMAIL");
    const password = this.configService.get<string>("ADMIN_PASSWORD");
    const name = this.configService.get<string>("ADMIN_NAME") ?? "Super Admin";
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";

    const hasEmail = Boolean(email && email.trim() !== "");
    const hasPassword = Boolean(password && password.trim() !== "");

    // Handle partial credentials (one is provided without the other)
    if ((hasEmail && !hasPassword) || (!hasEmail && hasPassword)) {
      if (isProduction) {
        throw new Error(
          "Startup failed: Partial administrator seed credentials configured in production. Both ADMIN_EMAIL and ADMIN_PASSWORD must be provided to seed the initial administrator.",
        );
      }
      this.logger.warn(
        "Partial administrator seed credentials configured: both ADMIN_EMAIL and ADMIN_PASSWORD are required to seed an initial administrator. Automatic admin seed skipped.",
      );
      return;
    }

    // Handle completely missing credentials
    if (!hasEmail && !hasPassword) {
      if (isProduction) {
        throw new Error(
          "Startup failed: No administrator exists in database and required seed credentials (ADMIN_EMAIL, ADMIN_PASSWORD) are missing in production.",
        );
      }
      this.logger.warn(
        "No administrator user exists, and ADMIN_EMAIL/ADMIN_PASSWORD are not configured. Automatic admin seed skipped.",
      );
      return;
    }

    const hashedPassword = await this.authService.hashPassword(password!);
    const admin = this.usersRepo.create({
      name,
      email: email!.toLowerCase().trim(),
      password: hashedPassword,
      role: UserRole.ADMIN,
    });

    try {
      await this.usersRepo.save(admin);
      this.logger.log(`Initial administrator user bootstrapped successfully: ${email}`);
    } catch (err: unknown) {
      const errorMsg = (err as { message?: string })?.message ?? '';
      if (!errorMsg.includes('Duplicate entry')) {
        throw err;
      }
    }
  }
}
