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
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { ApiTags, ApiCookieAuth, ApiOperation, ApiResponse, ApiConsumes } from "@nestjs/swagger";
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
import { Attachment } from "./entities/attachment.entity";
import { AttachmentResponseDto } from "./dto/attachment-response.dto";
import { TaskQueryDto, MyTaskQueryDto } from "./dto/task-query.dto";
import { RejectTaskDto } from "./dto/reject-task.dto";
import { PaginatedResponseDto } from "../common/dto/paginated-response.dto";

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

  @ApiOperation({ summary: "List all tasks with pagination, sorting, and filtering (Admin only)" })
  @ApiResponse({ status: 200, description: "Paginated list of tasks" })
  @ApiResponse({ status: 400, description: "Invalid query parameters" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - Admin only" })
  @UseGuards(AdminGuard)
  @Get()
  async findAll(
    @Query() query: TaskQueryDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResponseDto<TaskResponseDto>> {
    const result = await this.tasksService.findAll(query, user);
    const serialized = result.data.map((task) => this.toResponseDto(task));
    return new PaginatedResponseDto(
      serialized,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @ApiOperation({ summary: "List current user assigned tasks with pagination, sorting, and filtering" })
  @ApiResponse({ status: 200, description: "Paginated list of my-tasks" })
  @ApiResponse({ status: 400, description: "Invalid query parameters" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @Get("my-tasks")
  async getMyTasks(
    @Query() query: MyTaskQueryDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResponseDto<TaskResponseDto>> {
    const result = await this.tasksService.findAllMyTasks(query, user);
    const serialized = result.data.map((task) => this.toResponseDto(task));
    return new PaginatedResponseDto(
      serialized,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
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

  @ApiOperation({ summary: "Reject a submitted task with reason" })
  @ApiResponse({ status: 201, description: "Task rejected back to IN_PROGRESS", type: TaskResponseDto })
  @ApiResponse({ status: 400, description: "Empty or missing reason" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - Insufficient permissions" })
  @ApiResponse({ status: 404, description: "Task not found" })
  @ApiResponse({ status: 409, description: "Task not in IN_REVIEW or project ARCHIVED" })
  @Post(":taskId/reject")
  async reject(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() dto: RejectTaskDto,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.reject(taskId, dto, user);
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

  @ApiOperation({ summary: "Upload attachment for a task" })
  @ApiConsumes("multipart/form-data")
  @ApiResponse({ status: 201, description: "Attachment uploaded successfully", type: AttachmentResponseDto })
  @ApiResponse({ status: 400, description: "Missing file payload" })
  @ApiResponse({ status: 404, description: "Task not found" })
  @ApiResponse({ status: 409, description: "Max 20 attachments reached or project ARCHIVED" })
  @ApiResponse({ status: 413, description: "File size exceeds 10MB limit" })
  @ApiResponse({ status: 415, description: "Unsupported media type or disallowed content" })
  @Post(":taskId/attachments")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: Number(process.env.MAX_FILE_SIZE ?? 10485760),
        files: 1,
      },
    }),
  )
  async uploadAttachment(
    @Param("taskId", ParseIntPipe) taskId: number,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
  ): Promise<AttachmentResponseDto> {
    const attachment = await this.tasksService.uploadAttachment(taskId, file, user);
    return this.toAttachmentResponseDto(attachment);
  }

  @ApiOperation({ summary: "List attachments for a task" })
  @ApiResponse({ status: 200, description: "List of task attachments", type: [AttachmentResponseDto] })
  @ApiResponse({ status: 404, description: "Task not found" })
  @Get(":taskId/attachments")
  async getAttachments(
    @Param("taskId", ParseIntPipe) taskId: number,
    @CurrentUser() user: User,
  ): Promise<AttachmentResponseDto[]> {
    const attachments = await this.tasksService.getAttachments(taskId, user);
    return attachments.map((a) => this.toAttachmentResponseDto(a));
  }

  @ApiOperation({ summary: "Download attachment file" })
  @ApiResponse({ status: 200, description: "Attachment file stream" })
  @ApiResponse({ status: 404, description: "Task or attachment not found" })
  @Get(":taskId/attachments/:attachmentId/download")
  async downloadAttachment(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Param("attachmentId", ParseIntPipe) attachmentId: number,
    @CurrentUser() user: User,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const { attachment, stream } = await this.tasksService.getAttachmentForDownload(
      taskId,
      attachmentId,
      user,
    );

    res.setHeader("Content-Type", attachment.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(attachment.originalName)}"`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    stream.pipe(res);
  }

  @ApiOperation({ summary: "Delete task attachment" })
  @ApiResponse({ status: 200, description: "Attachment deleted" })
  @ApiResponse({ status: 404, description: "Task or attachment not found" })
  @ApiResponse({ status: 409, description: "Cannot delete from archived project" })
  @Delete(":taskId/attachments/:attachmentId")
  async deleteAttachment(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Param("attachmentId", ParseIntPipe) attachmentId: number,
    @CurrentUser() user: User,
  ): Promise<{ message: string }> {
    return this.tasksService.deleteAttachment(taskId, attachmentId, user);
  }

  private toAttachmentResponseDto(attachment: Attachment): AttachmentResponseDto {
    return plainToInstance(AttachmentResponseDto, attachment, {
      excludeExtraneousValues: true,
    });
  }
}

