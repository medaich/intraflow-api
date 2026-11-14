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
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { TeamsService } from './teams.service';
import { AuthGuard } from '../guards/auth.guard';
import { AdminGuard } from '../guards/admin-auth.guard';
import { CurrentUser } from '../users/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { TeamResponseDto } from './dto/team-response.dto';
import { TeamMemberResponseDto } from './dto/team-member-response.dto';

@ApiTags('teams')
@ApiCookieAuth('session')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @ApiOperation({ summary: 'Create a new team (Admin only)' })
  @ApiResponse({ status: 201, description: 'Team created successfully', type: TeamResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 409, description: 'Team name already exists' })
  @Post()
  @UseGuards(AuthGuard, AdminGuard)
  async create(@Body() dto: CreateTeamDto): Promise<TeamResponseDto> {
    const team = await this.teamsService.create(dto);
    return plainToInstance(TeamResponseDto, team, { excludeExtraneousValues: true });
  }

  @ApiOperation({ summary: 'List all teams (Admin only)' })
  @ApiResponse({ status: 200, description: 'List of teams', type: [TeamResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @Get()
  @UseGuards(AuthGuard, AdminGuard)
  async findAll(): Promise<TeamResponseDto[]> {
    const teams = await this.teamsService.findAll();
    return teams.map((t) =>
      plainToInstance(TeamResponseDto, t, { excludeExtraneousValues: true }),
    );
  }

  @ApiOperation({ summary: 'Get current user team with roster' })
  @ApiResponse({ status: 200, description: 'Current user team with members', type: TeamResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User does not belong to any team' })
  @Get('my-team')
  @UseGuards(AuthGuard)
  async getMyTeam(@CurrentUser() user: User): Promise<TeamResponseDto> {
    const team = await this.teamsService.findMyTeam(user);
    return plainToInstance(TeamResponseDto, team, { excludeExtraneousValues: true });
  }

  @ApiOperation({ summary: 'Get team details by ID (Admin or Team Member)' })
  @ApiResponse({ status: 200, description: 'Team details with members', type: TeamResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  @Get(':teamId')
  @UseGuards(AuthGuard)
  async findOne(
    @Param('teamId', ParseIntPipe) teamId: number,
    @CurrentUser() user: User,
  ): Promise<TeamResponseDto> {
    const team = await this.teamsService.findOne(teamId, user);
    return plainToInstance(TeamResponseDto, team, { excludeExtraneousValues: true });
  }

  @ApiOperation({ summary: 'Update team name or description (Admin only)' })
  @ApiResponse({ status: 200, description: 'Team updated successfully', type: TeamResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  @ApiResponse({ status: 409, description: 'Team name already exists' })
  @Patch(':teamId')
  @UseGuards(AuthGuard, AdminGuard)
  async update(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamResponseDto> {
    const team = await this.teamsService.update(teamId, dto);
    return plainToInstance(TeamResponseDto, team, { excludeExtraneousValues: true });
  }

  @ApiOperation({ summary: 'Soft delete team if no active members or projects (Admin only)' })
  @ApiResponse({ status: 204, description: 'Team soft-deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'Team not found' })
  @ApiResponse({ status: 409, description: 'Team has active members or projects' })
  @Delete(':teamId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AdminGuard)
  async remove(@Param('teamId', ParseIntPipe) teamId: number): Promise<void> {
    await this.teamsService.remove(teamId);
  }

  @ApiOperation({ summary: 'Add a user to team roster (Admin or Moderator)' })
  @ApiResponse({ status: 201, description: 'Member added to team', type: TeamMemberResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Team or user not found' })
  @ApiResponse({ status: 409, description: 'User already in a team' })
  @Post(':teamId/members')
  @UseGuards(AuthGuard)
  async addMember(
    @Param('teamId', ParseIntPipe) teamId: number,
    @CurrentUser() user: User,
    @Body() dto: AddMemberDto,
  ): Promise<TeamMemberResponseDto> {
    const membership = await this.teamsService.addMember(user, teamId, dto);
    return plainToInstance(TeamMemberResponseDto, membership, {
      excludeExtraneousValues: true,
    });
  }

  @ApiOperation({ summary: 'Update member role within team (Admin only)' })
  @ApiResponse({ status: 200, description: 'Member role updated', type: TeamMemberResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  @ApiResponse({ status: 404, description: 'Team or member not found' })
  @Patch(':teamId/members/:userId')
  @UseGuards(AuthGuard)
  async updateMemberRole(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('userId', ParseIntPipe) targetUserId: number,
    @CurrentUser() user: User,
    @Body() dto: UpdateMemberDto,
  ): Promise<TeamMemberResponseDto> {
    const membership = await this.teamsService.updateMemberRole(
      user,
      teamId,
      targetUserId,
      dto,
    );
    return plainToInstance(TeamMemberResponseDto, membership, {
      excludeExtraneousValues: true,
    });
  }

  @ApiOperation({ summary: 'Remove member from team roster (Admin or Moderator)' })
  @ApiResponse({ status: 204, description: 'Member removed from team' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Team or member not found' })
  @Delete(':teamId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async removeMember(
    @Param('teamId', ParseIntPipe) teamId: number,
    @Param('userId', ParseIntPipe) targetUserId: number,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.teamsService.removeMember(user, teamId, targetUserId);
  }
}
