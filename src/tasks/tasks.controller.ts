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
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "src/guards/admin-auth.guard";
import { AuthGuard } from "src/guards/auth.guard";
import { CurrentUser } from "src/users/decorators/current-user.decorator";
import { User } from "src/users/entities/user.entity";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { TasksService } from "./tasks.service";
import { CreateCommentDto } from "./dto/create-comment.dto";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @UseGuards(AdminGuard)
  @Post()
  create(@Body() createTaskDto: CreateTaskDto) {
    return this.tasksService.create(createTaskDto);
  }

  @UseGuards(AdminGuard)
  @Get()
  async findAll() {
    return this.tasksService.findAll();
  }

  @UseGuards(AuthGuard)
  @Get("my-tasks")
  async getMyTasks(@CurrentUser() user: User) {
    return this.tasksService.findAll(user.userId);
  }

  @UseGuards(AuthGuard)
  @Get("my-tasks/:taskId")
  async getMyTaskDetails(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ) {
    return this.tasksService.getMytask(taskId, user.userId);
  }

  @UseGuards(AuthGuard)
  @Post("my-tasks/:taskId/start")
  async start(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ) {
    return this.tasksService.start(taskId, user.userId);
  }

  @UseGuards(AuthGuard)
  @Post("my-tasks/:taskId/submit")
  async submit(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ) {
    return this.tasksService.submit(taskId, user.userId);
  }

  @UseGuards(AuthGuard)
  @Get("my-tasks/:taskId/comments")
  async getMyTaskComments(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ) {
    return this.tasksService.getMyTaskComments(taskId, user.userId);
  }

  @UseGuards(AuthGuard)
  @Put("my-tasks/:taskId/comments/:commentId")
  async updateComment(
    @CurrentUser() user: User,
    @Param("commentId", ParseIntPipe) commentId: number,
    @Body() comment: CreateCommentDto,
  ) {
    return this.tasksService.updateComment(
      commentId,
      user.userId,
      comment.content,
    );
  }

  @UseGuards(AuthGuard)
  @Delete("my-tasks/:taskId/comments/:commentId")
  async removeComment(
    @CurrentUser() user: User,
    @Param("commentId", ParseIntPipe) commentId: number,
  ) {
    return this.tasksService.removeComment(commentId, user.userId);
  }

  @UseGuards(AuthGuard)
  @Post("my-tasks/:taskId/comments")
  async comment(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() comment: CreateCommentDto,
  ) {
    return this.tasksService.comment(taskId, user.userId, comment.content);
  }

  @UseGuards(AdminGuard)
  @Get(":taskId")
  async findOne(@Param("taskId", ParseIntPipe) taskId: number) {
    return this.tasksService.findOne(taskId);
  }

  @UseGuards(AdminGuard)
  @Patch(":taskId")
  async update(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() updateTaskDto: UpdateTaskDto,
  ) {
    return this.tasksService.update(taskId, updateTaskDto);
  }

  @UseGuards(AdminGuard)
  @Delete(":taskId")
  async remove(@Param("taskId", ParseIntPipe) taskId: number) {
    return this.tasksService.remove(taskId);
  }

  @UseGuards(AdminGuard)
  @Post(":taskId/assign")
  async assign(
    @Param("taskId", ParseIntPipe) taskId: number,
    @Query("assignTo", ParseIntPipe) assignTo: number,
  ) {
    return this.tasksService.assign(taskId, assignTo);
  }
  @UseGuards(AdminGuard)
  @Post(":taskId/unassign")
  async unassign(@Param("taskId", ParseIntPipe) taskId: number) {
    return this.tasksService.unassign(taskId);
  }

  @UseGuards(AdminGuard)
  @Post(":taskId/validate")
  async validate(@Param("taskId", ParseIntPipe) taskId: number) {
    return this.tasksService.validate(taskId);
  }

  @UseGuards(AdminGuard)
  @Get(":taskId/comments")
  async getComments(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
  ) {
    return this.tasksService.getMyTaskComments(taskId, user.userId, true);
  }

  @UseGuards(AdminGuard)
  @Post(":taskId/comments")
  async commentAsAdmin(
    @CurrentUser() user: User,
    @Param("taskId", ParseIntPipe) taskId: number,
    @Body() comment: CreateCommentDto,
  ) {
    return this.tasksService.comment(
      taskId,
      user.userId,
      comment.content,
      true,
    );
  }

  @UseGuards(AdminGuard)
  @Delete(":taskId/comments/:commentId")
  async removeCommentAsAdmin(
    @CurrentUser() user: User,
    @Param("commentId", ParseIntPipe) commentId: number,
  ) {
    return this.tasksService.removeComment(commentId, user.userId, true);
  }
}
