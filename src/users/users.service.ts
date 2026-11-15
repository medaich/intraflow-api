import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { UpdateUserDto } from "./dto/update-user.dto";
import { EntityManager, IsNull, Repository } from "typeorm";
import { User, UserRole } from "./entities/user.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Invited } from "./entities/invited.entity";
import { ConfigService } from "@nestjs/config";
import { SignupDto } from "../auth/dto/signup.dto";
import { Team } from "../teams/entities/team.entity";
import { TeamMembership, TeamMemberRole } from "../teams/entities/team-membership.entity";
import { Task, TaskStatus } from "../tasks/entities/task.entity";
import { Comment } from "../tasks/entities/comment.entity";
import { EmailChangeRequest } from "./entities/email-change-request.entity";
import { MailService } from "../mail/mail.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ChangeEmailDto } from "./dto/change-email.dto";
import { ConfirmEmailDto } from "./dto/confirm-email.dto";
import { SessionData } from "../common/types/session.interface";
import { hashPassword, verifyPassword } from "../auth/password-hasher";
import { createHash, randomBytes } from "crypto";
import { UserQueryDto } from "./dto/user-query.dto";
import { PaginatedResponseDto } from "../common/dto/paginated-response.dto";
import { parseSort } from "../common/utils/sort-parser";
import { escapeLikeString } from "../common/utils/search-escaper";

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(Invited)
    private readonly invitedRepo: Repository<Invited>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(EmailChangeRequest)
    private readonly emailChangeRepo: Repository<EmailChangeRequest>,
    private readonly entityManager: EntityManager,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async create(userData: Partial<User>): Promise<User> {
    const user = new User(userData);
    return this.entityManager.save(user);
  }

  async findAll(query: UserQueryDto = new UserQueryDto()): Promise<PaginatedResponseDto<User>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.usersRepository
      .createQueryBuilder("user")
      .leftJoinAndSelect("user.membership", "membership");

    if (query.role) {
      qb.andWhere("user.role = :role", { role: query.role });
    }

    if (query.teamId) {
      qb.andWhere("membership.teamId = :teamId", { teamId: query.teamId });
    }

    if (query.search) {
      const escaped = `%${escapeLikeString(query.search)}%`;
      qb.andWhere(
        "(user.name LIKE :search ESCAPE '\\\\' OR user.email LIKE :search ESCAPE '\\\\')",
        { search: escaped },
      );
    }

    const sort = parseSort(query.sort, ["name", "createdAt"]);
    if (sort) {
      const column = sort.field === "name" ? "user.name" : "user.createdAt";
      qb.orderBy(column, sort.direction);
      qb.addOrderBy("user.userId", "ASC");
    } else {
      qb.orderBy("user.userId", "ASC");
    }

    const total = await qb.getCount();
    const users = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const sanitized = users.map((user) => new User({ ...user, password: undefined }));
    return new PaginatedResponseDto(sanitized, total, page, limit);
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
      relations: ["membership"],
    });
  }

  async findOne({ userId, email }: { userId?: number; email?: string }): Promise<User | null> {
    if (!userId && !email) return null;

    if (userId) {
      const user = await this.usersRepository.findOne({
        where: { userId },
        relations: ["membership"],
      });
      if (!user) throw new NotFoundException("No user found!");
      return new User({ ...user, password: undefined });
    }

    if (email) {
      const user = await this.usersRepository.findOne({
        where: { email: email.toLowerCase() },
        relations: ["membership"],
      });
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

    await this.entityManager.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { userId } });
      if (!user) {
        throw new NotFoundException("User not found");
      }

      if (user.role === UserRole.ADMIN) {
        // Lock all active admin rows to serialize admin deletions
        const activeAdmins = await manager
          .createQueryBuilder(User, "u")
          .setLock("pessimistic_write")
          .where("u.role = :role", { role: UserRole.ADMIN })
          .andWhere("u.deletedAt IS NULL")
          .getMany();

        if (activeAdmins.length <= 1) {
          throw new BadRequestException("Cannot delete the last remaining administrator");
        }
      }

      // Soft delete the user
      await manager.softDelete(User, userId);

      // Reset all open non-COMPLETED tasks assigned to this user (standalone, project, team)
      const tasksToReset = await manager
        .createQueryBuilder(Task, "task")
        .where("task.assigned_to = :userId", { userId })
        .andWhere("task.status != :completedStatus", { completedStatus: TaskStatus.COMPLETED })
        .andWhere("task.deleted_at IS NULL")
        .getMany();

      for (const task of tasksToReset) {
        task.assignedTo = null;
        task.status = TaskStatus.UNASSIGNED;
        task.startedAt = null;
        task.submittedAt = null;

        await manager.save(Task, task);

        const comment = manager.create(Comment, {
          content: `[System] User was deactivated. Task reset to UNASSIGNED.`,
          user: null,
          task,
          isSystem: true,
        });

        await manager.save(Comment, comment);
      }

      // Check for team membership
      const membership = await manager.findOne(TeamMembership, { where: { userId } });
      if (membership) {
        await manager.delete(TeamMembership, { id: membership.id });
      }
    });
  }

  async invite(
    email: string,
    role: UserRole = UserRole.EMPLOYEE,
    teamId?: number,
  ): Promise<Invited> {
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

    if (teamId !== undefined && teamId !== null) {
      const team = await this.entityManager.findOne(Team, { where: { teamId } });
      if (!team) {
        throw new NotFoundException(`Team with id ${teamId} not found`);
      }
    }

    const expiration = Number(this.configService.get("TOKEN_EXPIRATION")) || 86400;
    const expiresAt = new Date(Date.now() + expiration * 1000);

    const invited = this.invitedRepo.create({
      email: normalizedEmail,
      role,
      teamId: teamId ?? null,
      expiresAt,
    });

    const savedInvite = await this.invitedRepo.save(invited);

    // Send invitation email AFTER DB commit. If email fails, delete invite and return 502
    try {
      await this.mailService.sendInvitation(normalizedEmail, savedInvite.token);
    } catch {
      await this.invitedRepo.delete({ token: savedInvite.token });
      throw new BadGatewayException("Failed to send invitation email");
    }

    return savedInvite;
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

      // If invite has teamId, create membership in the same transaction
      if (invited.teamId) {
        const team = await manager.findOne(Team, { where: { teamId: invited.teamId } });
        // If team was deleted between invite and signup, signup still succeeds without membership
        if (team && !team.deletedAt) {
          const membership = manager.create(TeamMembership, {
            teamId: invited.teamId,
            userId: savedUser.userId,
            role: TeamMemberRole.MEMBER,
          });
          await manager.save(TeamMembership, membership);
        } else {
          this.logger.warn(
            `Invite token had teamId ${invited.teamId} but team was deleted or not found. User ${savedUser.userId} created without team membership.`,
          );
        }
      }

      return savedUser;
    });
  }

  async changePassword(
    userId: number,
    dto: ChangePasswordDto,
    session?: SessionData,
  ): Promise<{ message: string }> {
    const user = await this.usersRepository
      .createQueryBuilder("user")
      .addSelect("user.password")
      .where("user.userId = :userId", { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const isCurrentValid = await verifyPassword(dto.currentPassword, user.password);
    if (!isCurrentValid) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException("New password cannot be the same as the current password");
    }

    const hashedPassword = await hashPassword(dto.newPassword);
    const now = new Date();
    user.password = hashedPassword;
    user.sessionsValidFrom = now;
    await this.usersRepository.save(user);

    if (session) {
      session.iat = Math.max(Date.now(), now.getTime() + 1000);
    }

    return { message: "Password updated successfully" };
  }

  async requestEmailChange(
    userId: number,
    dto: ChangeEmailDto,
  ): Promise<{ message: string }> {
    const normalizedNewEmail = dto.newEmail.trim().toLowerCase();

    const user = await this.usersRepository
      .createQueryBuilder("user")
      .addSelect("user.password")
      .where("user.userId = :userId", { userId })
      .getOne();

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const isCurrentValid = await verifyPassword(dto.currentPassword, user.password);
    if (!isCurrentValid) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    if (normalizedNewEmail === user.email.toLowerCase()) {
      throw new BadRequestException("New email must be different from current email");
    }

    let tokenToSend: string | null = null;

    await this.entityManager.transaction(async (manager) => {
      const userToLock = await manager.findOne(User, {
        where: { userId },
        lock: { mode: "pessimistic_write" },
      });

      if (!userToLock) {
        throw new NotFoundException("User not found");
      }

      const existingUser = await manager.findOne(User, {
        where: { email: normalizedNewEmail },
      });
      if (existingUser) {
        throw new ConflictException("Email address is already in use");
      }

      const token = randomBytes(32).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const ttlSeconds = Number(this.configService.get<number>("EMAIL_CHANGE_TOKEN_TTL", 86400));
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      const requestRepo = manager.getRepository(EmailChangeRequest);

      // Invalidate active pending requests for this user
      await requestRepo.update(
        { userId, usedAt: IsNull() },
        { usedAt: new Date() },
      );

      // Save new request
      await requestRepo.save({
        userId,
        newEmail: normalizedNewEmail,
        tokenHash,
        expiresAt,
      });

      tokenToSend = token;
    });

    // Send verification email to the new address
    if (tokenToSend) {
      await this.mailService.sendEmailChangeVerification(normalizedNewEmail, tokenToSend);
    }

    return { message: "Verification email sent to the new address." };
  }

  async confirmEmailChange(
    dto: ConfirmEmailDto,
  ): Promise<{ message: string }> {
    const tokenHash = createHash("sha256").update(dto.token).digest("hex");

    let oldEmailToNotify: string | null = null;

    await this.entityManager.transaction(async (manager) => {
      const requestRepo = manager.getRepository(EmailChangeRequest);
      const changeRequest = await requestRepo.findOne({
        where: { tokenHash },
        lock: { mode: "pessimistic_write" },
      });

      if (
        !changeRequest ||
        changeRequest.usedAt !== null ||
        changeRequest.expiresAt.getTime() <= Date.now()
      ) {
        throw new BadRequestException("Invalid or expired token");
      }

      const userRepo = manager.getRepository(User);

      // Race condition check: make sure newEmail was not claimed in the meantime
      const raceUser = await userRepo.findOne({
        where: { email: changeRequest.newEmail },
        lock: { mode: "pessimistic_write" },
      });
      if (raceUser && raceUser.userId !== changeRequest.userId) {
        throw new ConflictException("Email address is already in use");
      }

      const targetUser = await userRepo.findOne({
        where: { userId: changeRequest.userId },
        lock: { mode: "pessimistic_write" },
      });

      if (!targetUser || targetUser.deletedAt) {
        throw new BadRequestException("Invalid or expired token");
      }

      oldEmailToNotify = targetUser.email;

      targetUser.email = changeRequest.newEmail;
      targetUser.sessionsValidFrom = new Date();
      await userRepo.save(targetUser);

      changeRequest.usedAt = new Date();
      await requestRepo.save(changeRequest);
    });

    if (oldEmailToNotify) {
      try {
        await this.mailService.sendEmailChangeNotice(oldEmailToNotify);
      } catch {
        // Logging only; do not fail confirmation
      }
    }

    return { message: "Email address successfully updated." };
  }
}

