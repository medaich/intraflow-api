import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Project, ProjectStatus } from './entities/project.entity';
import { Team } from '../teams/entities/team.entity';
import { Task, TaskStatus } from '../tasks/entities/task.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { TeamMemberRole } from '../teams/entities/team-membership.entity';
import { AccessPolicyService } from '../auth/policy/access-policy.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { SetProjectTeamDto } from './dto/set-project-team.dto';
import { calculateProjectProgress, checkProjectIsOverdue } from './project-progress';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Team)
    private readonly teamRepo: Repository<Team>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly policyService: AccessPolicyService,
  ) {}

  async create(dto: CreateProjectDto, creator: User): Promise<Project> {
    if (dto.teamId) {
      const team = await this.teamRepo.findOne({ where: { teamId: dto.teamId } });
      if (!team) {
        throw new NotFoundException(`Team with id ${dto.teamId} not found`);
      }
    }

    const project = this.projectRepo.create({
      name: dto.name,
      description: dto.description ?? null,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      teamId: dto.teamId ?? null,
      createdBy: creator.userId,
      status: ProjectStatus.ACTIVE,
    });

    const saved = await this.projectRepo.save(project);
    return this.enrichProject(saved);
  }

  async findAll(caller: User): Promise<Project[]> {
    let projects: Project[];

    if (caller.role === UserRole.ADMIN) {
      projects = await this.projectRepo.find({
        relations: ['team'],
        order: { projectId: 'ASC' },
      });
    } else {
      const teamId = caller.membership?.teamId;
      if (!teamId) {
        return [];
      }
      projects = await this.projectRepo.find({
        where: { teamId },
        relations: ['team'],
        order: { projectId: 'ASC' },
      });
    }

    if (projects.length === 0) {
      return [];
    }

    const projectIds = projects.map((p) => p.projectId);
    const rawCounts: Array<{ projectId: number; total: string; completed: string }> =
      await this.taskRepo
        .createQueryBuilder('task')
        .select('task.projectId', 'projectId')
        .addSelect('COUNT(task.taskId)', 'total')
        .addSelect(
          `SUM(CASE WHEN task.status = '${TaskStatus.COMPLETED}' THEN 1 ELSE 0 END)`,
          'completed',
        )
        .where('task.projectId IN (:...projectIds)', { projectIds })
        .groupBy('task.projectId')
        .getRawMany();

    const countsMap = new Map<number, { total: number; completed: number }>();
    for (const r of rawCounts) {
      countsMap.set(Number(r.projectId), {
        total: Number(r.total || 0),
        completed: Number(r.completed || 0),
      });
    }

    return projects.map((p) =>
      this.enrichProject(
        p,
        countsMap.get(p.projectId) ?? { total: 0, completed: 0 },
      ),
    );
  }

  async findOne(projectId: number, caller: User): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { projectId },
      relations: ['tasks', 'team'],
    });

    if (!project) {
      throw new NotFoundException(`Project with id ${projectId} not found`);
    }

    if (!this.policyService.canViewProject(caller, project)) {
      throw new NotFoundException(`Project with id ${projectId} not found`);
    }

    return this.enrichProject(project);
  }

  async update(projectId: number, dto: UpdateProjectDto, caller: User): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { projectId },
      relations: ['tasks', 'team'],
    });

    if (!project) {
      throw new NotFoundException(`Project with id ${projectId} not found`);
    }

    if (!this.policyService.canViewProject(caller, project)) {
      throw new NotFoundException(`Project with id ${projectId} not found`);
    }

    const isCallerAdmin = caller.role === UserRole.ADMIN;
    const isCallerTeamModerator =
      caller.membership?.teamId === project.teamId &&
      caller.membership?.role === TeamMemberRole.MODERATOR;

    if (!isCallerAdmin) {
      if (!isCallerTeamModerator) {
        throw new ForbiddenException('Only team moderators or administrators can update projects');
      }

      // Moderator may ONLY set status to COMPLETED
      const hasOtherFields =
        dto.name !== undefined ||
        dto.description !== undefined ||
        dto.startDate !== undefined ||
        dto.endDate !== undefined ||
        (dto.status !== undefined && dto.status !== ProjectStatus.COMPLETED);

      if (hasOtherFields) {
        throw new ForbiddenException('Moderators can only mark project status as COMPLETED');
      }
    }

    // Setting COMPLETED requires all its tasks to be COMPLETED (409 otherwise)
    if (dto.status === ProjectStatus.COMPLETED) {
      const incompleteCount = await this.taskRepo.count({
        where: {
          projectId,
          status: Not(TaskStatus.COMPLETED),
        },
      });

      if (incompleteCount > 0) {
        throw new ConflictException(
          'Cannot mark project as COMPLETED while incomplete tasks remain',
        );
      }
      project.status = ProjectStatus.COMPLETED;
    } else if (dto.status !== undefined && isCallerAdmin) {
      project.status = dto.status;
    }

    if (isCallerAdmin) {
      if (dto.name !== undefined) project.name = dto.name;
      if (dto.description !== undefined) project.description = dto.description ?? null;
      if (dto.startDate !== undefined) project.startDate = dto.startDate ?? null;
      if (dto.endDate !== undefined) project.endDate = dto.endDate ?? null;
    }

    const saved = await this.projectRepo.save(project);
    return this.enrichProject(saved);
  }

  async setTeam(projectId: number, dto: SetProjectTeamDto): Promise<Project> {
    const project = await this.projectRepo.findOne({
      where: { projectId },
      relations: ['tasks', 'team'],
    });

    if (!project) {
      throw new NotFoundException(`Project with id ${projectId} not found`);
    }

    // Changing or clearing a project's team while it has non-COMPLETED tasks that are assigned -> 409
    const assignedOpenTasksCount = await this.taskRepo.count({
      where: {
        projectId,
        status: Not(TaskStatus.COMPLETED),
        assignedTo: Not(IsNull()),
      },
    });

    if (assignedOpenTasksCount > 0) {
      throw new ConflictException(
        'Cannot change or clear project team while it has assigned non-COMPLETED tasks',
      );
    }

    if (dto.teamId !== null && dto.teamId !== undefined) {
      const team = await this.teamRepo.findOne({ where: { teamId: dto.teamId } });
      if (!team) {
        throw new NotFoundException(`Team with id ${dto.teamId} not found`);
      }
      project.teamId = dto.teamId;
    } else {
      project.teamId = null;
    }

    const saved = await this.projectRepo.save(project);
    return this.enrichProject(saved);
  }

  async remove(projectId: number): Promise<void> {
    const project = await this.projectRepo.findOne({ where: { projectId } });
    if (!project) {
      throw new NotFoundException(`Project with id ${projectId} not found`);
    }

    // Deleting a project that has tasks -> 409 (use ARCHIVED instead)
    const taskCount = await this.taskRepo.count({ where: { projectId } });
    if (taskCount > 0) {
      throw new ConflictException(
        'Cannot delete a project that still contains tasks; use ARCHIVED status instead',
      );
    }

    await this.projectRepo.softDelete(projectId);
  }

  private enrichProject(
    project: Project,
    aggregateCounts?: { total: number; completed: number },
  ): Project {
    const progress = aggregateCounts
      ? {
          total: aggregateCounts.total,
          completed: aggregateCounts.completed,
          percent:
            aggregateCounts.total === 0
              ? 0
              : Math.round(
                  (aggregateCounts.completed / aggregateCounts.total) * 100,
                ),
        }
      : calculateProjectProgress(project.tasks ?? []);
    const isOverdue = checkProjectIsOverdue(project.endDate, project.status);

    return Object.assign(project, { progress, isOverdue });
  }
}
