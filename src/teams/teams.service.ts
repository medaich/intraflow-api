import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Team } from './entities/team.entity';
import { TeamMembership, TeamMemberRole } from './entities/team-membership.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { Project } from '../projects/entities/project.entity';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { Comment } from '../tasks/entities/comment.entity';
import { AccessPolicyService } from '../auth/policy/access-policy.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { TeamQueryDto } from './dto/team-query.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { parseSort } from '../common/utils/sort-parser';
import { escapeLikeString } from '../common/utils/search-escaper';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepo: Repository<Team>,
    @InjectRepository(TeamMembership)
    private readonly membershipRepo: Repository<TeamMembership>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    private readonly entityManager: EntityManager,
    private readonly policyService: AccessPolicyService,
  ) {}

  async create(dto: CreateTeamDto): Promise<Team> {
    const existing = await this.teamRepo.findOne({
      where: { name: dto.name },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException(`Team with name "${dto.name}" already exists`);
    }

    const team = this.teamRepo.create({
      name: dto.name,
      description: dto.description ?? null,
    });
    return this.teamRepo.save(team);
  }

  async findAll(query: TeamQueryDto = new TeamQueryDto()): Promise<PaginatedResponseDto<Team>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.teamRepo.createQueryBuilder('team');

    if (query.search) {
      const escaped = `%${escapeLikeString(query.search)}%`;
      qb.andWhere("team.name LIKE :search ESCAPE '\\\\'", { search: escaped });
    }

    const sort = parseSort(query.sort, ['name', 'createdAt']);
    if (sort) {
      const column = sort.field === 'name' ? 'team.name' : 'team.createdAt';
      qb.orderBy(column, sort.direction);
      qb.addOrderBy('team.teamId', 'ASC');
    } else {
      qb.orderBy('team.teamId', 'ASC');
    }

    const total = await qb.getCount();
    const teams = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    if (teams.length > 0) {
      const teamIds = teams.map((t) => t.teamId);
      const teamsWithMembers = await this.teamRepo.find({
        where: { teamId: In(teamIds) },
        relations: ['members', 'members.user'],
      });
      const memberMap = new Map<number, TeamMembership[]>();
      for (const tm of teamsWithMembers) {
        memberMap.set(tm.teamId, tm.members ?? []);
      }
      for (const t of teams) {
        t.members = memberMap.get(t.teamId) ?? [];
      }
    }

    return new PaginatedResponseDto(teams, total, page, limit);
  }

  async findOne(teamId: number, caller: User): Promise<Team> {
    const team = await this.teamRepo.findOne({
      where: { teamId },
      relations: ['members', 'members.user'],
    });

    if (!team) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    if (!this.policyService.canViewTeam(caller, team)) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    return team;
  }

  async findMyTeam(caller: User): Promise<Team> {
    const teamId = caller.membership?.teamId;
    if (!teamId) {
      throw new NotFoundException('Current user does not belong to any team');
    }

    const team = await this.teamRepo.findOne({
      where: { teamId },
      relations: ['members', 'members.user'],
    });

    if (!team) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    return team;
  }

  async update(teamId: number, dto: UpdateTeamDto): Promise<Team> {
    const team = await this.teamRepo.findOne({ where: { teamId } });
    if (!team) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    if (dto.name && dto.name !== team.name) {
      const existing = await this.teamRepo.findOne({
        where: { name: dto.name },
        withDeleted: true,
      });
      if (existing) {
        throw new ConflictException(`Team with name "${dto.name}" already exists`);
      }
      team.name = dto.name;
    }

    if (dto.description !== undefined) {
      team.description = dto.description ?? null;
    }

    return this.teamRepo.save(team);
  }

  async remove(teamId: number): Promise<void> {
    const team = await this.teamRepo.findOne({ where: { teamId } });
    if (!team) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    const memberCount = await this.membershipRepo.count({ where: { teamId } });
    if (memberCount > 0) {
      throw new ConflictException('Cannot delete a team that still has active members');
    }

    const projectCount = await this.projectRepo.count({ where: { teamId } });
    if (projectCount > 0) {
      throw new ConflictException('Cannot delete a team that still has active projects');
    }

    await this.teamRepo.softDelete(teamId);
  }

  async addMember(caller: User, teamId: number, dto: AddMemberDto): Promise<TeamMembership> {
    const team = await this.teamRepo.findOne({ where: { teamId } });
    if (!team) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    if (!this.policyService.canViewTeam(caller, team)) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    const role = dto.role ?? TeamMemberRole.MEMBER;
    if (!this.policyService.canManageTeamRoster(caller, team, role)) {
      throw new ForbiddenException('Insufficient permissions to add this role to the team roster');
    }

    const targetUser = await this.userRepo.findOne({
      where: { userId: dto.userId },
      relations: ['membership'],
    });

    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException(`User with id ${dto.userId} not found`);
    }

    if (targetUser.role === UserRole.ADMIN) {
      throw new BadRequestException('Admins cannot be members of a team');
    }

    if (targetUser.membership) {
      throw new ConflictException('User already belongs to a team');
    }

    const existingMembership = await this.membershipRepo.findOne({
      where: { userId: dto.userId },
    });
    if (existingMembership) {
      throw new ConflictException('User already belongs to a team');
    }

    const membership = this.membershipRepo.create({
      teamId,
      userId: dto.userId,
      role,
      user: targetUser,
      team,
    });

    return this.membershipRepo.save(membership);
  }

  async updateMemberRole(
    caller: User,
    teamId: number,
    targetUserId: number,
    dto: UpdateMemberDto,
  ): Promise<TeamMembership> {
    const team = await this.teamRepo.findOne({ where: { teamId } });
    if (!team) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    if (!this.policyService.canViewTeam(caller, team)) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    // Only Admin may change member roles; moderators cannot change roles
    if (caller.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only administrators can change team membership roles');
    }

    const membership = await this.membershipRepo.findOne({
      where: { teamId, userId: targetUserId },
      relations: ['user'],
    });

    if (!membership) {
      throw new NotFoundException(`Member with user id ${targetUserId} not found in this team`);
    }

    membership.role = dto.role;
    return this.membershipRepo.save(membership);
  }

  async removeMember(caller: User, teamId: number, targetUserId: number): Promise<void> {
    const team = await this.teamRepo.findOne({ where: { teamId } });
    if (!team) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    if (!this.policyService.canViewTeam(caller, team)) {
      throw new NotFoundException(`Team with id ${teamId} not found`);
    }

    const membership = await this.membershipRepo.findOne({
      where: { teamId, userId: targetUserId },
      relations: ['user'],
    });

    if (!membership) {
      throw new NotFoundException(`Member with user id ${targetUserId} not found in this team`);
    }

    // Authorization checks for removal
    if (caller.role !== UserRole.ADMIN) {
      const isCallerTeamModerator =
        caller.membership?.teamId === teamId &&
        caller.membership?.role === TeamMemberRole.MODERATOR;

      if (!isCallerTeamModerator) {
        throw new ForbiddenException('Only team moderators or administrators can remove members');
      }

      // Moderator may NOT remove moderators (including themselves)
      if (membership.role === TeamMemberRole.MODERATOR) {
        throw new ForbiddenException('Moderators cannot remove other moderators or themselves');
      }
    }

    // Atomic transaction for membership deletion + open tasks reset + system comments
    await this.entityManager.transaction(async (manager) => {
      // 1. Delete membership
      await manager.delete(TeamMembership, { id: membership.id });

      // 2. Find all non-COMPLETED tasks assigned to targetUser in this team's projects
      const tasksToReset = await manager
        .createQueryBuilder(Task, 'task')
        .innerJoinAndSelect('task.project', 'project')
        .where('project.team_id = :teamId', { teamId })
        .andWhere('task.assigned_to = :userId', { userId: targetUserId })
        .andWhere('task.status != :completedStatus', { completedStatus: TaskStatus.COMPLETED })
        .andWhere('task.deleted_at IS NULL')
        .getMany();

      for (const task of tasksToReset) {
        task.assignedTo = null;
        task.status = TaskStatus.UNASSIGNED;
        task.startedAt = null;
        task.submittedAt = null;

        await manager.save(Task, task);

        const comment = manager.create(Comment, {
          content: `[System] User was removed from team. Task reset to UNASSIGNED.`,
          user: null,
          task,
          isSystem: true,
        });

        await manager.save(Comment, comment);
      }
    });
  }
}
