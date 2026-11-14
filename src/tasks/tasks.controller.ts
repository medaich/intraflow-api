import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiCookieAuth, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { plainToInstance } from "class-transformer";
import { AdminGuard } from "../guards/admin-auth.guard";
import { AuthGuard } from "../guards/auth.guard";
import { CurrentUser } from "../users/decorators/current-user.decorator";
import { User, UserRole } from "../users/entities/user.entity";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { TaskResponseDto } from "./dto/task-response.dto";
import { AssignTaskDto } from "./dto/assign-task.dto";
import { SetDependenciesDto } from "./dto/set-dependencies.dto";
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

  // Standalone task creation is admin-only
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

  @Get("my-tasks")
  async getMyTasks(@CurrentUser() user: User): Promise<TaskResponseDto[]> {
    const tasks = await this.tasksService.findAll(user.userId);
    return tasks.map((task) => this.toResponseDto(task));
  }

  @Get("my-tasks/:taskId")
  async getMyTaskDetails(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.getMytask(taskId, user.userId);
    return this.toResponseDto(task);
  }

  @Post("my-tasks/:taskId/start")
  async startMyTask(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.start(taskId, user.userId);
    return this.toResponseDto(task);
  }

  @Patch(":taskId/start")
  async startTask(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.start(taskId, user.userId);
    return this.toResponseDto(task);
  }

  @Post("my-tasks/:taskId/submit")
  async submitMyTask(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.submit(taskId, user.userId);
    return this.toResponseDto(task);
  }

  @Patch(":taskId/submit")
  async submitTask(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.submit(taskId, user.userId);
    return this.toResponseDto(task);
  }

  @Get("my-tasks/:taskId/comments")
  async getMyTaskComments(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<CommentResponseDto[]> {
    const comments = await this.tasksService.getMyTaskComments(taskId, user.userId);
    return comments.map((comment) => this.toCommentResponseDto(comment));
  }

  @Put("my-tasks/:taskId/comments/:commentId")
  async updateMyComment(
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

  @Delete("my-tasks/:taskId/comments/:commentId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMyComment(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Param("commentId", ParseIntPipe) commentId: number,
  ): Promise<void> {
    await this.tasksService.removeComment(taskId, commentId, user.userId, user);
  }

  @Post("my-tasks/:taskId/comments")
  async commentOnMyTask(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() comment: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const created = await this.tasksService.comment(taskId, user.userId, comment.content, user);
    return this.toCommentResponseDto(created);
  }

  // Generalized Task Routes with Policy-Based Authorization
  @Get(":taskId")
  async findOne(
    @Param("taskId", ParseIntPipe) taskId: number,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.findOne(taskId, user);
    return this.toResponseDto(task);
  }

  @Patch(":taskId")
  async update(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() updateTaskDto: UpdateTaskDto,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.update(taskId, updateTaskDto, user);
    return this.toResponseDto(task);
  }

  @Delete(":taskId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("taskId", ParseIntPipe) taskId: number,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.tasksService.remove(taskId, user);
  }

  @Post(":taskId/assign")
  async assignPost(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() assignTaskDto: AssignTaskDto,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.assign(taskId, assignTaskDto.userId, user);
    return this.toResponseDto(task);
  }

  @Patch(":taskId/assign")
  async assignPatch(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() assignTaskDto: AssignTaskDto,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.assign(taskId, assignTaskDto.userId, user);
    return this.toResponseDto(task);
  }

  @Post(":taskId/unassign")
  async unassignPost(
    @Param("taskId", ParseIntPipe) taskId: number,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.unassign(taskId, user);
    return this.toResponseDto(task);
  }

  @Patch(":taskId/unassign")
  async unassignPatch(
    @Param("taskId", ParseIntPipe) taskId: number,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.unassign(taskId, user);
    return this.toResponseDto(task);
  }

  @Post(":taskId/validate")
  async validatePost(
    @Param("taskId", ParseIntPipe) taskId: number,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.validate(taskId, user);
    return this.toResponseDto(task);
  }

  @Patch(":taskId/validate")
  async validatePatch(
    @Param("taskId", ParseIntPipe) taskId: number,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.validate(taskId, user);
    return this.toResponseDto(task);
  }

  @ApiOperation({ summary: "Set task dependencies with cycle detection" })
  @ApiResponse({ status: 200, description: "Dependencies updated", type: TaskResponseDto })
  @ApiResponse({ status: 400, description: "Self or cross-project dependency error" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - Insufficient permissions" })
  @ApiResponse({ status: 404, description: "Task or dependency not found" })
  @ApiResponse({ status: 409, description: "Dependency cycle detected or project is ARCHIVED" })
  @Put(":taskId/dependencies")
  async setDependencies(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() dto: SetDependenciesDto,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.setDependencies(taskId, dto, user);
    return this.toResponseDto(task);
  }

  @Get(":taskId/comments")
  async getComments(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ): Promise<CommentResponseDto[]> {
    const comments = await this.tasksService.getMyTaskComments(
      taskId,
      user.userId,
      user.role === UserRole.ADMIN,
    );
    return comments.map((comment) => this.toCommentResponseDto(comment));
  }

  @Post(":taskId/comments")
  async commentOnTask(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() comment: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const created = await this.tasksService.comment(
      taskId,
      user.userId,
      comment.content,
      user,
    );
    return this.toCommentResponseDto(created);
  }

  @Put(":taskId/comments/:commentId")
  async updateTaskComment(
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

  @Delete(":taskId/comments/:commentId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTaskComment(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Param("commentId", ParseIntPipe) commentId: number,
  ): Promise<void> {
    await this.tasksService.removeComment(taskId, commentId, user.userId, user);
  }
}
