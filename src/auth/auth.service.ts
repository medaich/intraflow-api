import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, IsNull, Repository } from "typeorm";
import { ConfigService } from "@nestjs/config";
import { UsersService } from "../users/users.service";
import { MailService } from "../mail/mail.service";
import { createHash, randomBytes } from "crypto";
import { SigninDto } from "./dto/signin.dto";
import { SignupDto } from "./dto/signup.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { User } from "../users/entities/user.entity";
import { PasswordResetToken } from "./entities/password-reset-token.entity";
import {
  DUMMY_HASH,
  hashPassword,
  verifyPassword,
} from "./password-hasher";

export { DUMMY_HASH, hashPassword, verifyPassword };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Precomputed dummy hash so scrypt always runs with equal cost on missing users
  private readonly dummyHash = DUMMY_HASH;

  constructor(
    private usersService: UsersService,
    @InjectRepository(PasswordResetToken)
    private resetTokenRepo: Repository<PasswordResetToken>,
    private mailService: MailService,
    private configService: ConfigService,
    private dataSource: DataSource,
  ) {}

  async hashPassword(password: string): Promise<string> {
    return hashPassword(password);
  }

  async verifyPassword(
    password: string,
    storedPasswordHash: string,
  ): Promise<boolean> {
    return verifyPassword(password, storedPasswordHash);
  }

  async signup(token: string, signupDto: SignupDto): Promise<User> {
    const hashedPassword = await this.hashPassword(signupDto.password);
    return this.usersService.registerWithInvite(token, signupDto, hashedPassword);
  }

  async signin(signinDto: SigninDto): Promise<User> {
    const { email, password } = signinDto;

    const user = await this.usersService.findByEmailWithPassword(email.toLowerCase());

    if (!user) {
      // Burn equal CPU cycles with dummy scrypt verification to prevent timing attacks
      await this.verifyPassword(password, this.dummyHash);
      throw new UnauthorizedException("Invalid credentials");
    }

    const isValid = await this.verifyPassword(password, user.password);
    if (!isValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return user;
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.usersService.findByEmailWithPassword(normalizedEmail);

    if (!user || user.deletedAt) {
      // Burn equal CPU cycles with dummy scrypt verification to prevent timing attacks
      await this.verifyPassword("dummy_timing_padding", this.dummyHash);
      return {
        message:
          "If that email address is in our database, we will send you an email to reset your password.",
      };
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const ttlSeconds = Number(this.configService.get<number>("RESET_TOKEN_TTL", 3600));
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Invalidate active reset tokens for this user
    await this.resetTokenRepo.update(
      { userId: user.userId, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    // Save new reset token
    await this.resetTokenRepo.save({
      userId: user.userId,
      tokenHash,
      expiresAt,
    });

    // Dispatch reset email asynchronously without awaiting SMTP in request path
    void this.mailService
      .sendPasswordReset(user.email, token)
      .catch((err: Error) => {
        this.logger.error(
          `Failed to send password reset email to ${user.email}: ${err.message}`,
          err.stack,
        );
      });

    return {
      message:
        "If that email address is in our database, we will send you an email to reset your password.",
    };
  }

  async resetPassword(resetDto: ResetPasswordDto): Promise<{ message: string }> {
    const { token, password } = resetDto;
    const tokenHash = createHash("sha256").update(token).digest("hex");

    return await this.dataSource.transaction(async (manager) => {
      const tokenRepo = manager.getRepository(PasswordResetToken);
      const resetToken = await tokenRepo.findOne({
        where: { tokenHash },
        lock: { mode: "pessimistic_write" },
      });

      if (
        !resetToken ||
        resetToken.usedAt !== null ||
        resetToken.expiresAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException("Invalid or expired token");
      }

      const userRepo = manager.getRepository(User);
      const user = await userRepo.findOne({
        where: { userId: resetToken.userId },
        lock: { mode: "pessimistic_write" },
      });

      if (!user || user.deletedAt) {
        throw new BadRequestException("Invalid or expired token");
      }

      // Mark token as used
      resetToken.usedAt = new Date();
      await tokenRepo.save(resetToken);

      // Hash new password and set sessionsValidFrom to now
      const hashedPassword = await this.hashPassword(password);
      user.password = hashedPassword;
      user.sessionsValidFrom = new Date();
      await userRepo.save(user);

      return { message: "Password has been reset successfully." };
    });
  }
}

