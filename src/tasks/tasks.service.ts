import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "src/users/entities/user.entity";
import { Repository } from "typeorm";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { Task, TaskStatus } from "./entities/task.entity";
import { Comment } from "./entities/comment.entity";
import { assertTaskTransition } from "./task-state-machine";

@Injectable()
export class TasksService {
  @InjectRepository(Task)
  private readonly tasksRepo: Repository<Task>;

  @InjectRepository(User)
  private readonly usersRepo: Repository<User>;

  @InjectRepository(Comment)
  private readonly commentRepo: Repository<Comment>;

  async create(createTaskDto: CreateTaskDto): Promise<Task> {
    const task = new Task(createTaskDto);
    return this.tasksRepo.save(task);
  }

  async findAll(assignedToId?: number): Promise<Task[]> {
    return assignedToId
      ? this.tasksRepo.find({
          where: { assignedTo: { userId: assignedToId } },
          relations: ["assignedTo"],
        })
      : this.tasksRepo.find({ relations: ["assignedTo"] });
  }

  async findOne(taskId: number): Promise<Task> {
    const task = await this.tasksRepo.findOne({
      where: { taskId },
      relations: ["assignedTo"],
    });
    if (!task) {
      throw new NotFoundException("Task not found");
    }
    return task;
  }

  async getMytask(taskId: number, userId: number): Promise<Task> {
    const task = await this.findOne(taskId);
    if (task.assignedTo?.userId !== userId) {
      throw new NotFoundException("Task not found!");
    }
    return task;
  }

  async update(taskId: number, updateTaskDto: UpdateTaskDto): Promise<Task> {
    const task = await this.findOne(taskId);
    Object.assign(task, updateTaskDto);
    return this.tasksRepo.save(task);
  }

  async remove(taskId: number): Promise<void> {
    await this.findOne(taskId);
    await this.tasksRepo.softDelete(taskId);
  }

  async assign(taskId: number, userId: number): Promise<Task> {
    const task = await this.findOne(taskId);
    assertTaskTransition(task.status, TaskStatus.PENDING);

    const user = await this.usersRepo.findOneBy({ userId });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    task.assignedTo = user;
    task.status = TaskStatus.PENDING;
    return this.tasksRepo.save(task);
  }

  async unassign(taskId: number): Promise<Task> {
    const task = await this.findOne(taskId);
    assertTaskTransition(task.status, TaskStatus.UNASSIGNED);

    task.assignedTo = null;
    task.status = TaskStatus.UNASSIGNED;
    return this.tasksRepo.save(task);
  }

  async start(taskId: number, userId: number): Promise<Task> {
    const task = await this.getMytask(taskId, userId);
    assertTaskTransition(task.status, TaskStatus.IN_PROGRESS);

    task.startedAt = new Date();
    task.status = TaskStatus.IN_PROGRESS;
    return this.tasksRepo.save(task);
  }

  async submit(taskId: number, userId: number): Promise<Task> {
    const task = await this.getMytask(taskId, userId);
    assertTaskTransition(task.status, TaskStatus.IN_REVIEW);

    task.submittedAt = new Date();
    task.status = TaskStatus.IN_REVIEW;
    return this.tasksRepo.save(task);
  }

  async validate(taskId: number): Promise<Task> {
    const task = await this.findOne(taskId);
    assertTaskTransition(task.status, TaskStatus.COMPLETED);

    task.status = TaskStatus.COMPLETED;
    task.completedAt = new Date();
    return this.tasksRepo.save(task);
  }

  async reject(taskId: number): Promise<Task> {
    const task = await this.findOne(taskId);
    assertTaskTransition(task.status, TaskStatus.IN_PROGRESS);

    task.status = TaskStatus.IN_PROGRESS;
    task.submittedAt = null;
    return this.tasksRepo.save(task);
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
      where: {
        task: { taskId },
      },
      relations: ["user"],
      select: {
        commentId: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        user: {
          userId: true,
          name: true,
        },
      },
      order: {
        createdAt: "ASC",
      },
    });
  }

  async comment(
    taskId: number,
    userId: number,
    content: string,
    isAdmin = false,
  ): Promise<Comment> {
    if (isAdmin) {
      await this.findOne(taskId);
    } else {
      await this.getMytask(taskId, userId);
    }

    const comment = new Comment({
      content,
      task: new Task({ taskId }),
      user: new User({ userId }),
    });
    return this.commentRepo.save(comment);
  }

  async getComment(commentId: number, taskId?: number): Promise<Comment> {
    if (!commentId || commentId <= 0) {
      throw new BadRequestException("Invalid comment ID");
    }

    const comment = await this.commentRepo.findOne({
      where: { commentId },
      relations: ["user", "task"],
      select: {
        commentId: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        user: {
          userId: true,
          name: true,
        },
        task: {
          taskId: true,
        },
      },
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

    // Users and admins can edit only their own comments
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
    isAdmin = false,
  ): Promise<void> {
    const comment = await this.getComment(commentId, taskId);

    // Users can delete only their own comments; admins can delete any comment
    if (!isAdmin && comment.user?.userId !== userId) {
      throw new ForbiddenException("Cannot delete another user's comment");
    }

    await this.commentRepo.softDelete(commentId);
  }
}
