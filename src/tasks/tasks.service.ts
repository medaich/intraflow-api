import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import { User, UserRole } from "../users/entities/user.entity";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { SetDependenciesDto } from "./dto/set-dependencies.dto";
import { Task, TaskPriority, TaskStatus } from "./entities/task.entity";
import { Comment } from "./entities/comment.entity";
import { Project, ProjectStatus } from "../projects/entities/project.entity";
import { Attachment } from "./entities/attachment.entity";
import { StorageService } from "../storage/storage.service";
import { MailService } from "../mail/mail.service";
import { detectAllowedContentType, sanitizeFilename } from "../storage/content-type-sniffer";
import { randomBytes } from "crypto";
import { TeamMemberRole } from "../teams/entities/team-membership.entity";
import { assertTaskTransition } from "./task-state-machine";
import { AccessPolicyService } from "../auth/policy/access-policy.service";
import { detectDependencyCycle } from "./cycle-detection";
import { ClockService } from "../common/clock/clock.service";
import { TaskTimeState, computeTaskTimeState } from "./task-time-state";
import { TaskQueryDto, MyTaskQueryDto, ProjectTaskQueryDto } from "./dto/task-query.dto";
import { RejectTaskDto } from "./dto/reject-task.dto";
import { PaginatedResponseDto } from "../common/dto/paginated-response.dto";
import { parseSort } from "../common/utils/sort-parser";
import { escapeLikeString } from "../common/utils/search-escaper";

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly tasksRepo: Repository<Task>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
    private readonly policyService: AccessPolicyService,
    private readonly storageService: StorageService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly clockService: ClockService,
  ) {}

  private checkProjectNotArchived(project: Project | null | undefined): void {
    if (project?.status === ProjectStatus.ARCHIVED) {
      throw new ConflictException(
        "Operation rejected: the project containing this task is ARCHIVED",
      );
    }
  }

  enrichTask(task: Task): Task {
    const dependencies = task.dependsOn ?? [];
    const dependsOnIds = dependencies.map((d) => d.taskId);
    const blockedByIds = dependencies
      .filter((d) => d.status !== TaskStatus.COMPLETED)
      .map((d) => d.taskId);
    const isBlocked = blockedByIds.length > 0;
    const now = this.clockService.now();
    const timeState = computeTaskTimeState(
      task.status,
      task.startDate,
      task.endDate,
      now,
    );

    return Object.assign(task, {
      dependsOn: dependsOnIds,
      blockedBy: blockedByIds,
      isBlocked,
      timeState,
    });
  }

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    const task = this.tasksRepo.create({
      ...createTaskDto,
      priority: createTaskDto.priority ?? TaskPriority.MEDIUM,
      projectId: null,
      status: TaskStatus.UNASSIGNED,
    });
    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async createInProject(
    projectId: number,
    createTaskDto: CreateTaskDto,
    caller: User,
  ): Promise<Task> {
    const project = await this.projectRepo.findOne({
      where: { projectId },
      relations: ["team"],
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

    if (!isCallerAdmin && !isCallerTeamModerator) {
      throw new ForbiddenException(
        "Only administrators or the team moderator can create tasks in this project",
      );
    }

    this.checkProjectNotArchived(project);

    const task = this.tasksRepo.create({
      ...createTaskDto,
      priority: createTaskDto.priority ?? TaskPriority.MEDIUM,
      projectId,
      status: TaskStatus.UNASSIGNED,
    });

    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async findPaginatedTasks(
    query: TaskQueryDto = new TaskQueryDto(),
    caller?: User,
    scope: {
      assignedToId?: number;
      projectId?: number;
    } = {},
  ): Promise<PaginatedResponseDto<Task>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.tasksRepo
      .createQueryBuilder("task")
      .leftJoinAndSelect("task.assignedTo", "assignedTo")
      .leftJoinAndSelect("task.project", "project");

    if (scope.assignedToId !== undefined) {
      qb.andWhere("task.assignedTo = :scopeAssignedToId", {
        scopeAssignedToId: scope.assignedToId,
      });
    }

    if (scope.projectId !== undefined) {
      qb.andWhere("task.projectId = :scopeProjectId", {
        scopeProjectId: scope.projectId,
      });
    }

    if (query.status) {
      qb.andWhere("task.status = :status", { status: query.status });
    }

    if (query.priority) {
      qb.andWhere("task.priority = :priority", { priority: query.priority });
    }

    if (query.assignedTo !== undefined && scope.assignedToId === undefined) {
      qb.andWhere("task.assignedTo = :assignedTo", {
        assignedTo: query.assignedTo,
      });
    }

    if (query.projectId !== undefined && scope.projectId === undefined) {
      qb.andWhere("task.projectId = :filterProjectId", {
        filterProjectId: query.projectId,
      });
    }

    if (query.search) {
      const escaped = `%${escapeLikeString(query.search)}%`;
      qb.andWhere("task.name LIKE :search ESCAPE '\\\\'", { search: escaped });
    }

    if (query.timeState) {
      const now = this.clockService.now();
      const nowIso = now.toISOString();

      switch (query.timeState) {
        case TaskTimeState.DONE:
          qb.andWhere("task.status = :completedStatus", {
            completedStatus: TaskStatus.COMPLETED,
          });
          break;
        case TaskTimeState.OVERDUE:
          qb.andWhere(
            "task.status != :completedStatus AND task.endDate < :nowIso",
            { completedStatus: TaskStatus.COMPLETED, nowIso },
          );
          break;
        case TaskTimeState.UPCOMING:
          qb.andWhere(
            "task.status != :completedStatus AND (task.endDate IS NULL OR task.endDate >= :nowIso) AND task.startDate > :nowIso",
            { completedStatus: TaskStatus.COMPLETED, nowIso },
          );
          break;
        case TaskTimeState.ACTIVE:
          qb.andWhere(
            "task.status != :completedStatus AND (task.endDate IS NULL OR task.endDate >= :nowIso) AND (task.startDate IS NULL OR task.startDate <= :nowIso)",
            { completedStatus: TaskStatus.COMPLETED, nowIso },
          );
          break;
      }
    }

    const sort = parseSort(query.sort, [
      "createdAt",
      "startDate",
      "endDate",
      "priority",
      "name",
      "status",
    ]);

    if (sort) {
      const columnMap: Record<string, string> = {
        createdAt: "task.createdAt",
        startDate: "task.startDate",
        endDate: "task.endDate",
        priority: "task.priority",
        name: "task.name",
        status: "task.status",
      };
      qb.orderBy(columnMap[sort.field], sort.direction);
      qb.addOrderBy("task.taskId", "ASC");
    } else {
      qb.orderBy("task.taskId", "ASC");
    }

    const total = await qb.getCount();
    const tasks = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    if (tasks.length > 0) {
      const taskIds = tasks.map((t) => t.taskId);
      const tasksWithDeps = await this.tasksRepo.find({
        where: { taskId: In(taskIds) },
        relations: ["dependsOn"],
      });
      const depsMap = new Map<number, Task[]>();
      for (const td of tasksWithDeps) {
        depsMap.set(td.taskId, td.dependsOn ?? []);
      }
      for (const t of tasks) {
        t.dependsOn = depsMap.get(t.taskId) ?? [];
      }
    }

    const enriched = tasks.map((t) => this.enrichTask(t));
    return new PaginatedResponseDto(enriched, total, page, limit);
  }

  async findProjectTasks(
    projectId: number,
    query: ProjectTaskQueryDto = new ProjectTaskQueryDto(),
    caller: User,
  ): Promise<PaginatedResponseDto<Task>> {
    const project = await this.projectRepo.findOne({
      where: { projectId },
      relations: ["team"],
    });

    if (!project) {
      throw new NotFoundException(`Project with id ${projectId} not found`);
    }

    if (!this.policyService.canViewProject(caller, project)) {
      throw new NotFoundException(`Project with id ${projectId} not found`);
    }

    return this.findPaginatedTasks(query as TaskQueryDto, caller, { projectId });
  }

  async findAll(
    query: TaskQueryDto = new TaskQueryDto(),
    caller?: User,
  ): Promise<PaginatedResponseDto<Task>> {
    return this.findPaginatedTasks(query, caller);
  }

  async findAllMyTasks(
    query: MyTaskQueryDto = new MyTaskQueryDto(),
    caller: User,
  ): Promise<PaginatedResponseDto<Task>> {
    return this.findPaginatedTasks(query as TaskQueryDto, caller, {
      assignedToId: caller.userId,
    });
  }

  async findOne(taskId: number, caller?: User): Promise<Task> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["assignedTo", "dependsOn", "dependentTasks", "project", "project.team"],
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    if (caller && caller.role !== UserRole.ADMIN) {
      const isAssigned = task.assignedTo?.userId === caller.userId;
      if (!isAssigned) {
        if (!task.projectId || !task.project) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canViewProject(caller, task.project)) {
          throw new NotFoundException("Task not found");
        }
      }
    }

    return this.enrichTask(task);
  }

  async getMytask(taskId: number, userId: number): Promise<Task> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["assignedTo", "dependsOn", "project"],
    });

    if (!task || task.assignedTo?.userId !== userId) {
      throw new NotFoundException("Task not found!");
    }

    return this.enrichTask(task);
  }

  async update(taskId: number, updateTaskDto: UpdateTaskDto, caller?: User): Promise<Task> {
    const task = await this.findOne(taskId, caller);

    if (caller && !this.policyService.canManageTask(caller, task)) {
      throw new ForbiddenException("Cannot manage this task");
    }

    this.checkProjectNotArchived(task.project);

    Object.assign(task, updateTaskDto);
    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async assign(taskId: number, userId: number, caller?: User): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(Task, {
        where: { taskId },
        relations: ["assignedTo", "dependsOn", "project", "project.team"],
        lock: { mode: "pessimistic_write" },
      });

      if (!task) {
        throw new NotFoundException("Task not found");
      }

      if (caller && caller.role !== UserRole.ADMIN) {
        if (!task.projectId || !task.project) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canViewProject(caller, task.project)) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canManageTask(caller, task)) {
          throw new ForbiddenException("Cannot assign tasks in this project");
        }
      }

      this.checkProjectNotArchived(task.project);
      assertTaskTransition(task.status, TaskStatus.PENDING);

      const user = await manager.findOne(User, {
        where: { userId },
        relations: ["membership"],
      });

      if (!user || user.deletedAt) {
        throw new NotFoundException("User not found");
      }

      if (user.role === UserRole.ADMIN) {
        throw new BadRequestException("Admins cannot be assigned to tasks");
      }

      // Assignment rule: if project has a team, assignee must belong to that team
      if (task.project?.teamId) {
        if (user.membership?.teamId !== task.project.teamId) {
          throw new BadRequestException(
            "Assignee must be a member or moderator of the project team",
          );
        }
      } else {
        // Standalone or team-less project: only Admin can assign
        if (caller && caller.role !== UserRole.ADMIN) {
          throw new ForbiddenException("Only administrators can assign standalone tasks");
        }
      }

      task.assignedTo = user;
      task.status = TaskStatus.PENDING;
      const saved = await manager.save(Task, task);

      // Send task assignment email (try/catch: failure logged, does not fail request)
      try {
        await this.mailService.sendTaskAssigned(
          user.email,
          user.name,
          saved.name,
          task.project?.name,
        );
      } catch {
        // Logging only; do not fail request
      }

      return this.enrichTask(saved);
    });
  }

  async unassign(taskId: number, caller?: User): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(Task, {
        where: { taskId },
        relations: ["assignedTo", "dependsOn", "project", "project.team"],
        lock: { mode: "pessimistic_write" },
      });

      if (!task) {
        throw new NotFoundException("Task not found");
      }

      if (caller && caller.role !== UserRole.ADMIN) {
        if (!task.projectId || !task.project) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canViewProject(caller, task.project)) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canManageTask(caller, task)) {
          throw new ForbiddenException("Cannot unassign tasks in this project");
        }
      }

      this.checkProjectNotArchived(task.project);
      assertTaskTransition(task.status, TaskStatus.UNASSIGNED);

      task.assignedTo = null;
      task.status = TaskStatus.UNASSIGNED;
      const saved = await manager.save(Task, task);
      return this.enrichTask(saved);
    });
  }

  async start(taskId: number, userId: number): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(Task, {
        where: { taskId },
        relations: ["assignedTo", "dependsOn", "project"],
        lock: { mode: "pessimistic_write" },
      });

      if (!task || task.assignedTo?.userId !== userId) {
        throw new NotFoundException("Task not found!");
      }

      this.checkProjectNotArchived(task.project);

      // Blocking dependency check: all dependencies must be COMPLETED
      const dependencies = task.dependsOn ?? [];
      const blockingTasks = dependencies.filter((d) => d.status !== TaskStatus.COMPLETED);
      if (blockingTasks.length > 0) {
        const blockingTaskIds = blockingTasks.map((d) => d.taskId);
        throw new ConflictException({
          statusCode: 409,
          message: "Task cannot be started because dependencies are not completed",
          blockingTaskIds,
        });
      }

      assertTaskTransition(task.status, TaskStatus.IN_PROGRESS);

      task.startedAt = new Date();
      task.status = TaskStatus.IN_PROGRESS;
      const saved = await manager.save(Task, task);
      return this.enrichTask(saved);
    });
  }

  async submit(taskId: number, userId: number): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(Task, {
        where: { taskId },
        relations: ["assignedTo", "project"],
        lock: { mode: "pessimistic_write" },
      });

      if (!task || task.assignedTo?.userId !== userId) {
        throw new NotFoundException("Task not found!");
      }

      this.checkProjectNotArchived(task.project);
      assertTaskTransition(task.status, TaskStatus.IN_REVIEW);

      task.submittedAt = new Date();
      task.status = TaskStatus.IN_REVIEW;
      const saved = await manager.save(Task, task);
      return this.enrichTask(saved);
    });
  }

  async validate(taskId: number, caller?: User): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(Task, {
        where: { taskId },
        relations: ["assignedTo", "dependsOn", "project", "project.team"],
        lock: { mode: "pessimistic_write" },
      });

      if (!task) {
        throw new NotFoundException("Task not found");
      }

      if (caller && caller.role !== UserRole.ADMIN) {
        if (!task.projectId || !task.project) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canViewProject(caller, task.project)) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canReviewTask(caller, task)) {
          throw new ForbiddenException("Cannot review tasks in this project");
        }
      }

      this.checkProjectNotArchived(task.project);
      assertTaskTransition(task.status, TaskStatus.COMPLETED);

      task.status = TaskStatus.COMPLETED;
      task.completedAt = new Date();
      const saved = await manager.save(Task, task);
      return this.enrichTask(saved);
    });
  }

  async reject(
    taskId: number,
    dto: RejectTaskDto,
    caller: User,
  ): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(Task, {
        where: { taskId },
        relations: ["assignedTo", "dependsOn", "project", "project.team"],
        lock: { mode: "pessimistic_write" },
      });

      if (!task) {
        throw new NotFoundException("Task not found");
      }

      if (caller.role !== UserRole.ADMIN) {
        if (!task.projectId || !task.project) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canViewProject(caller, task.project)) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canReviewTask(caller, task)) {
          throw new ForbiddenException("Cannot review tasks in this project");
        }
      }

      this.checkProjectNotArchived(task.project);
      assertTaskTransition(task.status, TaskStatus.IN_PROGRESS);

      task.status = TaskStatus.IN_PROGRESS;
      task.submittedAt = null;
      await manager.save(Task, task);

      const comment = manager.create(Comment, {
        content: dto.reason.trim(),
        task,
        user: caller,
        isSystem: false,
      });
      await manager.save(Comment, comment);

      return this.enrichTask(task);
    });
  }

  async setDependencies(
    taskId: number,
    dto: SetDependenciesDto,
    caller: User,
  ): Promise<Task> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(Task, {
        where: { taskId },
        relations: ["dependsOn", "project", "project.team"],
      });

      if (!task) {
        throw new NotFoundException("Task not found");
      }

      if (caller.role !== UserRole.ADMIN) {
        if (!task.projectId || !task.project) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canViewProject(caller, task.project)) {
          throw new NotFoundException("Task not found");
        }
        if (!this.policyService.canManageTask(caller, task)) {
          throw new ForbiddenException("Cannot manage dependencies for this task");
        }
      }

      // Dependencies allowed only for tasks within a project (standalone cannot have dependencies)
      if (!task.projectId) {
        throw new BadRequestException("Standalone tasks cannot have dependencies");
      }

      // Lock project row to serialize all dependency modifications for this project
      const project = await manager.findOne(Project, {
        where: { projectId: task.projectId },
        lock: { mode: "pessimistic_write" },
      });
      if (!project) {
        throw new NotFoundException("Project not found");
      }
      this.checkProjectNotArchived(project);

      // Self dependency check
      if (dto.dependsOn.includes(taskId)) {
        throw new BadRequestException("Task cannot depend on itself");
      }

      let dependencyTasks: Task[] = [];
      if (dto.dependsOn.length > 0) {
        dependencyTasks = await manager.find(Task, {
          where: {
            taskId: In(dto.dependsOn),
          },
        });

        // All dependency IDs must exist and not be deleted
        if (dependencyTasks.length !== dto.dependsOn.length) {
          throw new NotFoundException("One or more dependency tasks not found");
        }

        // Same project only: all dependencies must belong to the exact same project
        for (const dep of dependencyTasks) {
          if (dep.projectId !== task.projectId) {
            throw new BadRequestException(
              "Task dependencies must belong to the same project",
            );
          }
        }

        // Cycle detection: load existing dependencies with locking read to bypass repeatable-read snapshot
        const rawDeps: { task_id: number; depends_on_task_id: number }[] =
          typeof manager.query === "function"
            ? await manager.query(
                `SELECT td.task_id, td.depends_on_task_id 
                 FROM task_dependencies td 
                 INNER JOIN tasks t ON t.task_id = td.task_id 
                 WHERE t.project_id = ? AND t.deleted_at IS NULL
                 FOR SHARE`,
                [task.projectId],
              )
            : [];

        const graph = new Map<number, number[]>();
        if (Array.isArray(rawDeps) && rawDeps.length > 0) {
          for (const row of rawDeps) {
            const list = graph.get(Number(row.task_id)) ?? [];
            list.push(Number(row.depends_on_task_id));
            graph.set(Number(row.task_id), list);
          }
        } else {
          const projectTasks = await manager.find(Task, {
            where: { projectId: task.projectId },
            relations: ["dependsOn"],
          });
          for (const t of projectTasks) {
            graph.set(
              t.taskId,
              (t.dependsOn ?? []).map((d) => d.taskId),
            );
          }
        }

        const hasCycle = detectDependencyCycle(taskId, dto.dependsOn, graph);
        if (hasCycle) {
          throw new ConflictException(
            "Cyclic dependency detected: dependencies cannot form a closed loop",
          );
        }
      }

      task.dependsOn = dependencyTasks;
      const saved = await manager.save(Task, task);
      return this.enrichTask(saved);
    });
  }

  async remove(taskId: number, caller?: User): Promise<void> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["dependentTasks", "project", "project.team"],
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    if (caller && caller.role !== UserRole.ADMIN) {
      if (!task.projectId || !task.project) {
        throw new NotFoundException("Task not found");
      }
      if (!this.policyService.canViewProject(caller, task.project)) {
        throw new NotFoundException("Task not found");
      }
      if (!this.policyService.canManageTask(caller, task)) {
        throw new ForbiddenException("Cannot delete tasks in this project");
      }
    }

    this.checkProjectNotArchived(task.project);

    // Soft-deleting a task that other active tasks depend on -> 409
    const activeDependents = await this.tasksRepo
      .createQueryBuilder("task")
      .innerJoin("task.dependsOn", "dependency")
      .where("dependency.task_id = :taskId", { taskId })
      .andWhere("task.deleted_at IS NULL")
      .getCount();

    if (activeDependents > 0) {
      throw new ConflictException(
        "Cannot delete task: other tasks depend on it",
      );
    }

    await this.tasksRepo.softDelete(taskId);
  }

  async getMyTaskComments(
    taskId: number,
    userId: number,
    isAdmin = false,
  ): Promise<Comment[]> {
    if (isAdmin) {
      await this.findOne(taskId);
    } else {
      await this.getMytask(taskId, userId);
    }

    return this.commentRepo.find({
      where: { task: { taskId } },
      relations: ["user"],
      order: { createdAt: "ASC" },
    });
  }

  async comment(
    taskId: number,
    userId: number,
    content: string,
    caller?: User | boolean,
  ): Promise<Comment> {
    const isAdmin = caller === true || (caller instanceof User && caller.role === UserRole.ADMIN);

    if (!isAdmin) {
      if (caller instanceof User) {
        const task = await this.findOne(taskId, caller);
        const isAssigned = task.assignedTo?.userId === userId;
        const isTeamMember =
          task.project?.teamId && caller?.membership?.teamId === task.project.teamId;

        if (!isAssigned && !isTeamMember) {
          throw new ForbiddenException("Cannot comment on this task");
        }
      } else {
        await this.getMytask(taskId, userId);
      }
    }

    const comment = this.commentRepo.create({
      content,
      task: new Task({ taskId }),
      user: new User({ userId }),
      isSystem: false,
    });

    const saved = await this.commentRepo.save(comment);
    return this.getComment(saved.commentId, taskId);
  }

  async getComment(commentId: number, taskId?: number): Promise<Comment> {
    if (!commentId || commentId <= 0) {
      throw new BadRequestException("Invalid comment ID");
    }

    const comment = await this.commentRepo.findOne({
      where: { commentId },
      relations: ["user", "task"],
    });

    if (!comment) {
      throw new NotFoundException("Comment not found");
    }

    if (taskId !== undefined && comment.task?.taskId !== taskId) {
      throw new NotFoundException("Comment not found for this task");
    }

    return comment;
  }

  async updateComment(
    taskId: number,
    commentId: number,
    userId: number,
    content: string,
  ): Promise<Comment> {
    const comment = await this.getComment(commentId, taskId);

    // Only comment owner can edit own comment
    if (comment.user?.userId !== userId) {
      throw new ForbiddenException("Cannot edit another user's comment");
    }

    comment.content = content;
    return this.commentRepo.save(comment);
  }

  async removeComment(
    taskId: number,
    commentId: number,
    userId: number,
    caller?: User | boolean,
  ): Promise<void> {
    const comment = await this.getComment(commentId, taskId);

    const isOwner = comment.user?.userId === userId;
    const isAdmin = caller === true || (caller instanceof User && caller.role === UserRole.ADMIN);

    let isModerator = false;
    if (caller instanceof User) {
      const task = await this.findOne(taskId, caller);
      isModerator = this.policyService.canModerateComments(caller, task);
    }

    if (!isOwner && !isAdmin && !isModerator) {
      throw new ForbiddenException("Cannot delete another user's comment");
    }

    await this.commentRepo.softDelete(commentId);
  }

  async uploadAttachment(
    taskId: number,
    file: Express.Multer.File,
    user: User,
  ): Promise<Attachment> {
    if (!file || !file.buffer) {
      throw new BadRequestException("No file provided");
    }

    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["project", "project.team", "assignedTo"],
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    if (!this.policyService.canManageAttachments(user, task)) {
      throw new NotFoundException("Task not found");
    }

    if (task.project?.status === ProjectStatus.ARCHIVED) {
      throw new ConflictException(
        "Cannot upload attachments to tasks in archived projects",
      );
    }

    const maxFileSize = Number(
      this.configService.get<number>("MAX_FILE_SIZE", 10485760),
    );
    if (file.size > maxFileSize) {
      throw new PayloadTooLargeException("File size exceeds 10MB limit");
    }

    const maxAttachments = Number(
      this.configService.get<number>("MAX_ATTACHMENTS_PER_TASK", 20),
    );
    const currentCount = await this.attachmentRepo.count({
      where: { taskId },
    });
    if (currentCount >= maxAttachments) {
      throw new ConflictException(
        `Task already has the maximum of ${maxAttachments} attachments`,
      );
    }

    const contentType = detectAllowedContentType(file.buffer, file.originalname);
    const originalName = sanitizeFilename(file.originalname);
    const storageKey = `${randomBytes(16).toString("hex")}-${Date.now()}`;

    // Write file first, then DB row. If DB row fails, delete the file.
    await this.storageService.put(storageKey, file.buffer);
    try {
      const attachment = this.attachmentRepo.create({
        taskId: task.taskId,
        uploadedById: user.userId,
        originalName,
        storageKey,
        contentType,
        size: file.size,
      });
      const saved = await this.attachmentRepo.save(attachment);
      const enriched = await this.attachmentRepo.findOne({
        where: { attachmentId: saved.attachmentId },
        relations: ["uploadedBy"],
      });
      return enriched!;
    } catch (err) {
      await this.storageService.delete(storageKey).catch(() => {});
      throw err;
    }
  }

  async getAttachments(taskId: number, user: User): Promise<Attachment[]> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["project", "project.team", "assignedTo"],
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    if (!this.policyService.canManageAttachments(user, task)) {
      throw new NotFoundException("Task not found");
    }

    return this.attachmentRepo.find({
      where: { taskId },
      relations: ["uploadedBy"],
      order: { createdAt: "ASC" },
    });
  }

  async getAttachmentForDownload(
    taskId: number,
    attachmentId: number,
    user: User,
  ): Promise<{ attachment: Attachment; stream: NodeJS.ReadableStream }> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["project", "project.team", "assignedTo"],
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    if (!this.policyService.canManageAttachments(user, task)) {
      throw new NotFoundException("Task not found");
    }

    const attachment = await this.attachmentRepo.findOne({
      where: { attachmentId, taskId },
    });

    if (!attachment) {
      throw new NotFoundException("Attachment not found");
    }

    const stream = await this.storageService.getStream(attachment.storageKey);
    return { attachment, stream };
  }

  async deleteAttachment(
    taskId: number,
    attachmentId: number,
    user: User,
  ): Promise<{ message: string }> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["project", "project.team", "assignedTo"],
    });

    if (!task) {
      throw new NotFoundException("Task not found");
    }

    const attachment = await this.attachmentRepo.findOne({
      where: { attachmentId, taskId },
    });

    if (!attachment) {
      throw new NotFoundException("Attachment not found");
    }

    if (!this.policyService.canDeleteAttachment(user, attachment, task)) {
      throw new NotFoundException("Attachment not found");
    }

    if (task.project?.status === ProjectStatus.ARCHIVED) {
      throw new ConflictException(
        "Cannot delete attachments from tasks in archived projects",
      );
    }

    const storageKey = attachment.storageKey;
    await this.attachmentRepo.delete(attachmentId);

    try {
      await this.storageService.delete(storageKey);
    } catch {
      // Log failure, do not crash
    }

    return { message: "Attachment deleted successfully" };
  }
}

