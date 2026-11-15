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
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { ProjectsService } from './projects.service';
import { AuthGuard } from '../guards/auth.guard';
import { AdminGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { SetProjectTeamDto } from './dto/set-project-team.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import { ProjectTaskQueryDto } from '../tasks/dto/task-query.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { CreateTaskDto } from '../tasks/dto/create-task.dto';
import { TaskResponseDto } from '../tasks/dto/task-response.dto';
import { TasksService } from '../tasks/tasks.service';

@ApiTags('projects')
@ApiCookieAuth('session')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly tasksService: TasksService,
  ) {}

  @ApiOperation({ summary: 'Create a new project (Admin or Moderator)' })
  @ApiResponse({ status: 201, description: 'Project created successfully', type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @Post()
  @UseGuards(AuthGuard, AdminGuard)
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: User,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.create(dto, user);
    return plainToInstance(ProjectResponseDto, project, { excludeExtraneousValues: true });
  }

  @ApiOperation({ summary: 'List visible projects with derived progress and overdue status' })
  @ApiResponse({ status: 200, description: 'Paginated list of projects' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @Get()
  @UseGuards(AuthGuard)
  async findAll(
    @Query() query: ProjectQueryDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResponseDto<ProjectResponseDto>> {
    const result = await this.projectsService.findAll(query, user);
    const serialized = result.data.map((p) =>
      plainToInstance(ProjectResponseDto, p, { excludeExtraneousValues: true }),
    );
    return new PaginatedResponseDto(
      serialized,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @ApiOperation({ summary: 'Get project details by ID' })
  @ApiResponse({ status: 200, description: 'Project details', type: ProjectResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @Get(':projectId')
  @UseGuards(AuthGuard)
  async findOne(
    @Param('projectId', ParseIntPipe) projectId: number,
    @CurrentUser() user: User,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.findOne(projectId, user);
    return plainToInstance(ProjectResponseDto, project, { excludeExtraneousValues: true });
  }

  @ApiOperation({ summary: 'Update project details or status (Admin or Moderator)' })
  @ApiResponse({ status: 200, description: 'Project updated successfully', type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Project is ARCHIVED or has conflicting state' })
  @Patch(':projectId')
  @UseGuards(AuthGuard)
  async update(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: User,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.update(projectId, dto, user);
    return plainToInstance(ProjectResponseDto, project, { excludeExtraneousValues: true });
  }

  @ApiOperation({ summary: 'Assign or reassign project team (Admin only)' })
  @ApiResponse({ status: 200, description: 'Project team updated', type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'Project or team not found' })
  @ApiResponse({ status: 409, description: 'Project has assigned tasks conflicting with new team' })
  @Put(':projectId/team')
  @UseGuards(AuthGuard, AdminGuard)
  async setTeam(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: SetProjectTeamDto,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectsService.setTeam(projectId, dto);
    return plainToInstance(ProjectResponseDto, project, { excludeExtraneousValues: true });
  }

  @ApiOperation({ summary: 'Soft delete project if no tasks exist (Admin only)' })
  @ApiResponse({ status: 204, description: 'Project soft-deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Cannot delete project with associated tasks' })
  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AdminGuard)
  async remove(@Param('projectId', ParseIntPipe) projectId: number): Promise<void> {
    await this.projectsService.remove(projectId);
  }

  @ApiOperation({ summary: 'Create a new task within a project (Admin or Moderator)' })
  @ApiResponse({ status: 201, description: 'Task created in project', type: TaskResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 409, description: 'Project is ARCHIVED' })
  @Post(':projectId/tasks')
  @UseGuards(AuthGuard)
  async createTaskInProject(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: User,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.createInProject(projectId, dto, user);
    return plainToInstance(TaskResponseDto, task, { excludeExtraneousValues: true });
  }

  @ApiOperation({ summary: 'List all tasks in a project' })
  @ApiResponse({ status: 200, description: 'Paginated list of project tasks' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @Get(':projectId/tasks')
  @UseGuards(AuthGuard)
  async getProjectTasks(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query() query: ProjectTaskQueryDto,
    @CurrentUser() user: User,
  ): Promise<PaginatedResponseDto<TaskResponseDto>> {
    const result = await this.tasksService.findProjectTasks(projectId, query, user);
    const serialized = result.data.map((t) =>
      plainToInstance(TaskResponseDto, t, { excludeExtraneousValues: true }),
    );
    return new PaginatedResponseDto(
      serialized,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }
}
