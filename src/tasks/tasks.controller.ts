import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { plainToInstance } from "class-transformer";
import { AdminGuard } from "src/guards/admin-auth.guard";
import { AuthGuard } from "src/guards/auth.guard";
import { CurrentUser } from "src/users/decorators/current-user.decorator";
import { User } from "src/users/entities/user.entity";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { TaskResponseDto } from "./dto/task-response.dto";
import { AssignTaskDto } from "./dto/assign-task.dto";
import { TasksService } from "./tasks.service";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { CommentResponseDto } from "./dto/comment-response.dto";
import { Task } from "./entities/task.entity";
import { Comment } from "./entities/comment.entity";

@ApiTags("tasks")
@ApiCookieAuth("session")
@UseGuards(AuthGuard)
@Controller("tasks")
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  private toResponseDto(task: Task): TaskResponseDto {
    return plainToInstance(TaskResponseDto, task, {
      excludeExtraneousValues: true,
    });
  }

  private toCommentResponseDto(comment: Comment): CommentResponseDto {
    return plainToInstance(CommentResponseDto, comment, {
      excludeExtraneousValues: true,
    });
  }

  @UseGuards(AdminGuard)
  @Post()
  async create(@Body() createTaskDto: CreateTaskDto): Promise<TaskResponseDto> {
    const task = await this.tasksService.create(createTaskDto);
    return this.toResponseDto(task);
  }

  @UseGuards(AdminGuard)
  @Get()
  async findAll(): Promise<TaskResponseDto[]> {
    const tasks = await this.tasksService.findAll();
    return tasks.map((task) => this.toResponseDto(task));
  }

  @UseGuards(AuthGuard)
  @Get("my-tasks")
  async getMyTasks(@CurrentUser() user: User): Promise<TaskResponseDto[]> {
    const tasks = await this.tasksService.findAll(user.userId);
    return tasks.map((task) => this.toResponseDto(task));
  }

  @UseGuards(AuthGuard)
  @Get("my-tasks/:taskId")
  async getMyTaskDetails(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.getMytask(taskId, user.userId);
    return this.toResponseDto(task);
  }

  @UseGuards(AuthGuard)
  @Post("my-tasks/:taskId/start")
  async start(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.start(taskId, user.userId);
    return this.toResponseDto(task);
  }

  @UseGuards(AuthGuard)
  @Post("my-tasks/:taskId/submit")
  async submit(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.submit(taskId, user.userId);
    return this.toResponseDto(task);
  }

  @UseGuards(AuthGuard)
  @Get("my-tasks/:taskId/comments")
  async getMyTaskComments(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<CommentResponseDto[]> {
    const comments = await this.tasksService.getMyTaskComments(taskId, user.userId);
    return comments.map((comment) => this.toCommentResponseDto(comment));
  }

  @UseGuards(AuthGuard)
  @Put("my-tasks/:taskId/comments/:commentId")
  async updateComment(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Param("commentId", ParseIntPipe) commentId: number,
    @Body() comment: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const updated = await this.tasksService.updateComment(
      taskId,
      commentId,
      user.userId,
      comment.content,
    );
    return this.toCommentResponseDto(updated);
  }

  @UseGuards(AuthGuard)
  @Delete("my-tasks/:taskId/comments/:commentId")
  async removeComment(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Param("commentId", ParseIntPipe) commentId: number,
  ): Promise<void> {
    await this.tasksService.removeComment(
      taskId,
      commentId,
      user.userId,
      false,
    );
  }

  @UseGuards(AuthGuard)
  @Post("my-tasks/:taskId/comments")
  async comment(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() comment: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const created = await this.tasksService.comment(taskId, user.userId, comment.content);
    return this.toCommentResponseDto(created);
  }

  @UseGuards(AdminGuard)
  @Get(":taskId")
  async findOne(@Param("taskId", ParseIntPipe) taskId: number): Promise<TaskResponseDto> {
    const task = await this.tasksService.findOne(taskId);
    return this.toResponseDto(task);
  }

  @UseGuards(AdminGuard)
  @Patch(":taskId")
  async update(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() updateTaskDto: UpdateTaskDto,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.update(taskId, updateTaskDto);
    return this.toResponseDto(task);
  }

  @UseGuards(AdminGuard)
  @Delete(":taskId")
  async remove(@Param("taskId", ParseIntPipe) taskId: number): Promise<void> {
    await this.tasksService.remove(taskId);
  }

  @UseGuards(AdminGuard)
  @Post(":taskId/assign")
  async assign(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() assignTaskDto: AssignTaskDto,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.assign(taskId, assignTaskDto.userId);
    return this.toResponseDto(task);
  }

  @UseGuards(AdminGuard)
  @Post(":taskId/unassign")
  async unassign(@Param("taskId", ParseIntPipe) taskId: number): Promise<TaskResponseDto> {
    const task = await this.tasksService.unassign(taskId);
    return this.toResponseDto(task);
  }

  @UseGuards(AdminGuard)
  @Post(":taskId/validate")
  async validate(@Param("taskId", ParseIntPipe) taskId: number): Promise<TaskResponseDto> {
    const task = await this.tasksService.validate(taskId);
    return this.toResponseDto(task);
  }

  @UseGuards(AdminGuard)
  @Get(":taskId/comments")
  async getComments(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<CommentResponseDto[]> {
    const comments = await this.tasksService.getMyTaskComments(taskId, user.userId, true);
    return comments.map((comment) => this.toCommentResponseDto(comment));
  }

  @UseGuards(AdminGuard)
  @Post(":taskId/comments")
  async commentAsAdmin(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() comment: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const created = await this.tasksService.comment(
      taskId,
      user.userId,
      comment.content,
      true,
    );
    return this.toCommentResponseDto(created);
  }

  @UseGuards(AdminGuard)
  @Delete(":taskId/comments/:commentId")
  async removeCommentAsAdmin(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Param("commentId", ParseIntPipe) commentId: number,
  ): Promise<void> {
    await this.tasksService.removeComment(taskId, commentId, user.userId, true);
  }
}
