import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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

  @UseGuards(AdminGuard)
  @Get(":taskId")
  async findOne(@Param("taskId") taskId: number) {
    return this.tasksService.findOne(taskId);
  }

  @UseGuards(AdminGuard)
  @Patch(":taskId")
  async update(
    @Param("taskId") taskId: number,
    @Body() updateTaskDto: UpdateTaskDto,
  ) {
    return this.tasksService.update(taskId, updateTaskDto);
  }

  @UseGuards(AdminGuard)
  @Delete(":taskId")
  async remove(@Param("taskId") taskId: number) {
    return this.tasksService.remove(taskId);
  }

  @UseGuards(AdminGuard)
  @Post(":taskId/assign")
  async assign(
    @Param("taskId") taskId: number,
    @Query("assignTo") assignTo: number,
  ) {
    return this.tasksService.assign(taskId, assignTo);
  }
  @UseGuards(AdminGuard)
  @Post(":taskId/unassign")
  async unassign(@Param("taskId") taskId: number) {
    return this.tasksService.unassign(taskId);
  }

  @UseGuards(AdminGuard)
  @Post(":taskId/validate")
  async validate(@Param("taskId") taskId: number) {
    return this.tasksService.validate(taskId);
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
    @Param("taskId") taskId: number,
  ) {
    return this.tasksService.getMytask(taskId, user.userId);
  }

  @UseGuards(AuthGuard)
  @Post("my-tasks/:taskId/start")
  async start(@CurrentUser() user: User, @Param("taskId") taskId: number) {
    return this.tasksService.start(taskId, user.userId);
  }

  @UseGuards(AuthGuard)
  @Post("my-tasks/:taskId/submit")
  async submit(@CurrentUser() user: User, @Param("taskId") taskId: number) {
    return this.tasksService.submit(taskId, user.userId);
  }
}
