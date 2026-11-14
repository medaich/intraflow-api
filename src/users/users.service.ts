import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UpdateUserDto } from "./dto/update-user.dto";
import { EntityManager, Repository } from "typeorm";
import { User, UserRole } from "./entities/user.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Invited } from "./entities/invited.entity";
import { ConfigService } from "@nestjs/config";
import { SignupDto } from "../auth/dto/signup.dto";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Invited)
    private readonly invitedRepo: Repository<Invited>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,

    private readonly entityManager: EntityManager,

    private readonly configService: ConfigService,
  ) {}

  async create(userData: Partial<User>): Promise<User> {
    const user = new User(userData);
    return this.entityManager.save(user);
  }

  async findAll(): Promise<User[]> {
    const users = await this.usersRepository.find();
    return users.map((user) => new User({ ...user, password: undefined }));
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    if (!email) return null;
    return this.usersRepository
      .createQueryBuilder("user")
      .addSelect("user.password")
      .where("LOWER(user.email) = LOWER(:email)", { email: email.toLowerCase() })
      .getOne();
  }

  async findByIdForAuth(userId: number): Promise<User | null> {
    if (!userId) return null;
    return this.usersRepository.findOne({
      where: { userId },
    });
  }

  async findOne({ userId, email }: { userId?: number; email?: string }): Promise<User | null> {
    if (!userId && !email) return null;

    if (userId) {
      const user = await this.usersRepository.findOneBy({ userId });
      if (!user) throw new NotFoundException("No user found!");
      return new User({ ...user, password: undefined });
    }

    if (email) {
      const user = await this.usersRepository.findOneBy({ email: email.toLowerCase() });
      if (user) {
        return new User({ ...user, password: undefined });
      }
    }
    return null;
  }

  async update(userId: number, updateUserDto: UpdateUserDto) {
    return this.usersRepository.update(userId, updateUserDto);
  }

  async remove(userId: number, currentAdminId?: number): Promise<void> {
    if (currentAdminId && userId === currentAdminId) {
      throw new BadRequestException("Admins cannot delete their own account");
    }

    const user = await this.usersRepository.findOne({ where: { userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (user.role === UserRole.ADMIN) {
      const adminCount = await this.usersRepository.count({
        where: { role: UserRole.ADMIN },
      });
      if (adminCount <= 1) {
        throw new BadRequestException("Cannot delete the last remaining administrator");
      }
    }

    await this.usersRepository.softDelete(userId);
  }

  async invite(email: string, role: UserRole = UserRole.EMPLOYEE): Promise<Invited> {
    const normalizedEmail = email.toLowerCase();
    const pastInvites = await this.invitedRepo.find({
      where: {
        email: normalizedEmail,
      },
      order: {
        expiresAt: "DESC",
      },
    });

    const hasValidInvite = pastInvites[0]?.expiresAt > new Date();
    if (hasValidInvite) {
      throw new ConflictException(
        "A valid invite already exists for this email",
      );
    }

    const userWithEmail = await this.findOne({ email: normalizedEmail });
    if (userWithEmail) {
      throw new ConflictException("This email is already registered");
    }

    const expiration = Number(this.configService.get("TOKEN_EXPIRATION")) || 86400;
    const expiresAt = new Date(Date.now() + expiration * 1000);

    const invited = this.invitedRepo.create({
      email: normalizedEmail,
      role,
      expiresAt,
    });

    return this.invitedRepo.save(invited);
  }

  async registerWithInvite(
    token: string,
    signupDto: SignupDto,
    hashedPassword: string,
  ): Promise<User> {
    return this.entityManager.transaction(async (manager) => {
      const invited = await manager.findOne(Invited, {
        where: { token },
        lock: { mode: "pessimistic_write" },
      });
      if (!invited) {
        throw new NotFoundException("Invite not found");
      }

      if (new Date() >= invited.expiresAt) {
        throw new HttpException("Invite has expired", HttpStatus.GONE);
      }

      if (invited.email.toLowerCase() !== signupDto.email.toLowerCase()) {
        throw new BadRequestException("Email does not match invite");
      }

      const existingUser = await manager.findOne(User, {
        where: { email: signupDto.email.toLowerCase() },
      });
      if (existingUser) {
        throw new ConflictException("User with this email already exists");
      }

      const deleteRes = await manager.delete(Invited, { token });
      if (deleteRes.affected !== 1) {
        throw new ConflictException("Invitation token already used or invalid");
      }

      const user = manager.create(User, {
        ...signupDto,
        email: signupDto.email.toLowerCase(),
        password: hashedPassword,
        role: invited.role ?? UserRole.EMPLOYEE,
      });

      const savedUser = await manager.save(User, user);
      return savedUser;
    });
  }
}
