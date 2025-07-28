import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { plainToInstance } from "class-transformer";
import { User } from "src/users/entities/user.entity";
import { Repository } from "typeorm";
import { CreateTaskDto } from "./dto/create-task.dto";
import { TaskResponseDto } from "./dto/task-response.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { Task, TaskStatus } from "./entities/task.entity";

@Injectable()
export class TasksService {
  @InjectRepository(Task)
  private readonly tasksRepo: Repository<Task>;

  @InjectRepository(User)
  private readonly usersRepo: Repository<User>;

  async create(createTaskDto: CreateTaskDto) {
    return this.tasksRepo.save(createTaskDto);
  }

  async findAll(assignedToId?: number) {
    const tasks = assignedToId
      ? await this.tasksRepo.find({
          where: { assignedTo: { userId: assignedToId } },
        })
      : await this.tasksRepo.find();

    return plainToInstance(TaskResponseDto, tasks, {
      excludeExtraneousValues: true,
    });
  }

  async findOne(taskId: number) {
    const task = await this.tasksRepo.findOneBy({ taskId });
    if (!task) throw new NotFoundException();
    return plainToInstance(TaskResponseDto, task, {
      excludeExtraneousValues: true,
    });
  }

  async update(taskId: number, updateTaskDto: UpdateTaskDto) {
    try {
      await this.findOne(taskId);
      await this.tasksRepo.update(taskId, updateTaskDto);
      return await this.findOne(taskId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      else throw new InternalServerErrorException();
    }
  }

  async remove(taskId: number) {
    try {
      await this.findOne(taskId);
      return this.tasksRepo.softDelete(taskId);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      else throw new InternalServerErrorException();
    }
  }

  async assign(taskId: number, userId: number) {
    try {
      const task = await this.findOne(taskId);
      const user = await this.usersRepo.findOneBy({ userId });
      if (!user) throw new NotFoundException("User not found");
      if (task.status !== TaskStatus.UNASSIGNED)
        throw new BadRequestException("Task already assigned!");
      task.assignedTo = user;
      task.status = TaskStatus.PENDING;
      return this.update(taskId, task);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      else throw new InternalServerErrorException();
    }
  }

  async unassign(taskId: number) {
    try {
      const task = await this.findOne(taskId);
      if (
        task.status !== TaskStatus.UNASSIGNED &&
        task.status !== TaskStatus.PENDING
      )
        throw new BadRequestException("Task already started");
      task.assignedTo = null;
      task.status = TaskStatus.UNASSIGNED;
      return this.update(taskId, task);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      else throw new InternalServerErrorException();
    }
  }

  async validate(taskId: number) {
    try {
      const task = await this.findOne(taskId);
      if (task.status !== TaskStatus.IN_REVIEW)
        throw new BadRequestException(
          "Task either not submitted or already reviewed",
        );

      task.status = TaskStatus.COMPLETED;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      else throw new InternalServerErrorException();
    }
  }

  async getMytask(taskId: number, userId: number) {
    try {
      const task = await this.findOne(taskId);
      if (task.assignedTo?.userId !== userId)
        throw new NotFoundException("Task not found!");

      return task;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      else throw new InternalServerErrorException();
    }
  }

  async start(taskId: number, userId: number) {
    try {
      const task = await this.getMytask(taskId, userId);

      if (task.status !== TaskStatus.PENDING)
        throw new BadRequestException(
          "Task either submitted or already started",
        );
      task.startedAt = new Date();
      task.status = TaskStatus.IN_PROGRESS;

      return this.update(taskId, task);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      else throw new InternalServerErrorException();
    }
  }

  async submit(taskId: number, userId: number) {
    try {
      const task = await this.getMytask(taskId, userId);

      if (task.status !== TaskStatus.IN_PROGRESS)
        throw new BadRequestException("Task either submitted or not started");
      task.startedAt = new Date();
      task.status = TaskStatus.IN_REVIEW;

      return this.update(taskId, task);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      else throw new InternalServerErrorException();
    }
  }
}
