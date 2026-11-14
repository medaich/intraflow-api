import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { User, UserRole } from "../users/entities/user.entity";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { SetDependenciesDto } from "./dto/set-dependencies.dto";
import { Task, TaskStatus } from "./entities/task.entity";
import { Comment } from "./entities/comment.entity";
import { Project, ProjectStatus } from "../projects/entities/project.entity";
import { TeamMemberRole } from "../teams/entities/team-membership.entity";
import { assertTaskTransition } from "./task-state-machine";
import { AccessPolicyService } from "../auth/policy/access-policy.service";
import { detectDependencyCycle } from "./cycle-detection";

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
    private readonly policyService: AccessPolicyService,
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

    return Object.assign(task, {
      dependsOn: dependsOnIds,
      blockedBy: blockedByIds,
      isBlocked,
    });
  }

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    const task = this.tasksRepo.create({
      ...createTaskDto,
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
      projectId,
      status: TaskStatus.UNASSIGNED,
    });

    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async findProjectTasks(projectId: number, caller: User): Promise<Task[]> {
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

    const tasks = await this.tasksRepo.find({
      where: { projectId },
      relations: ["assignedTo", "dependsOn", "project"],
      order: { taskId: "ASC" },
    });

    return tasks.map((t) => this.enrichTask(t));
  }

  async findAll(assignedToId?: number): Promise<Task[]> {
    const tasks = assignedToId
      ? await this.tasksRepo.find({
          where: { assignedTo: { userId: assignedToId } },
          relations: ["assignedTo", "dependsOn", "project"],
        })
      : await this.tasksRepo.find({
          relations: ["assignedTo", "dependsOn", "project"],
        });

    return tasks.map((t) => this.enrichTask(t));
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
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["assignedTo", "dependsOn", "project", "project.team"],
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

    const user = await this.usersRepo.findOne({
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
    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async unassign(taskId: number, caller?: User): Promise<Task> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["assignedTo", "dependsOn", "project", "project.team"],
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
    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async start(taskId: number, userId: number): Promise<Task> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["assignedTo", "dependsOn", "project"],
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
    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async submit(taskId: number, userId: number): Promise<Task> {
    const task = await this.getMytask(taskId, userId);
    this.checkProjectNotArchived(task.project);
    assertTaskTransition(task.status, TaskStatus.IN_REVIEW);

    task.submittedAt = new Date();
    task.status = TaskStatus.IN_REVIEW;
    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async validate(taskId: number, caller?: User): Promise<Task> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["assignedTo", "dependsOn", "project", "project.team"],
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
    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async reject(taskId: number, caller?: User): Promise<Task> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["assignedTo", "dependsOn", "project", "project.team"],
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
    assertTaskTransition(task.status, TaskStatus.IN_PROGRESS);

    task.status = TaskStatus.IN_PROGRESS;
    task.submittedAt = null;
    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
  }

  async setDependencies(
    taskId: number,
    dto: SetDependenciesDto,
    caller: User,
  ): Promise<Task> {
    const task = await this.tasksRepo.findOne({
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

    this.checkProjectNotArchived(task.project);

    // Dependencies allowed only for tasks within a project (standalone cannot have dependencies)
    if (!task.projectId) {
      throw new BadRequestException("Standalone tasks cannot have dependencies");
    }

    // Self dependency check
    if (dto.dependsOn.includes(taskId)) {
      throw new BadRequestException("Task cannot depend on itself");
    }

    let dependencyTasks: Task[] = [];
    if (dto.dependsOn.length > 0) {
      dependencyTasks = await this.tasksRepo.find({
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

      // Cycle detection: load existing dependencies for tasks in this project
      const projectTasks = await this.tasksRepo.find({
        where: { projectId: task.projectId },
        relations: ["dependsOn"],
      });

      const graph = new Map<number, number[]>();
      for (const t of projectTasks) {
        graph.set(
          t.taskId,
          (t.dependsOn ?? []).map((d) => d.taskId),
        );
      }

      const hasCycle = detectDependencyCycle(taskId, dto.dependsOn, graph);
      if (hasCycle) {
        throw new ConflictException(
          "Cyclic dependency detected: dependencies cannot form a closed loop",
        );
      }
    }

    task.dependsOn = dependencyTasks;
    const saved = await this.tasksRepo.save(task);
    return this.enrichTask(saved);
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
}
