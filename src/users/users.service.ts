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
import { Team } from "../teams/entities/team.entity";
import { TeamMembership, TeamMemberRole } from "../teams/entities/team-membership.entity";
import { Task, TaskStatus } from "../tasks/entities/task.entity";
import { Comment } from "../tasks/entities/comment.entity";

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
    const users = await this.usersRepository.find({
      relations: ["membership"],
    });
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
        const adminCount = await manager.count(User, {
          where: { role: UserRole.ADMIN },
        });
        if (adminCount <= 1) {
          throw new BadRequestException("Cannot delete the last remaining administrator");
        }
      }

      // Soft delete the user
      await manager.softDelete(User, userId);

      // Check for team membership
      const membership = await manager.findOne(TeamMembership, { where: { userId } });
      if (membership) {
        await manager.delete(TeamMembership, { id: membership.id });

        // Reset non-COMPLETED tasks in this team's projects
        const tasksToReset = await manager
          .createQueryBuilder(Task, "task")
          .innerJoinAndSelect("task.project", "project")
          .where("project.team_id = :teamId", { teamId: membership.teamId })
          .andWhere("task.assigned_to = :userId", { userId })
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
        }
      }

      return savedUser;
    });
  }
}
