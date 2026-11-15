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
  Query,
  Session,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { plainToInstance } from "class-transformer";
import { CurrentUser } from "./decorators/current-user.decorator";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersService } from "./users.service";
import { User } from "./entities/user.entity";
import { AuthGuard } from "../guards/auth.guard";
import { AdminGuard } from "../guards/admin-auth.guard";
import { InviteDto } from "./dto/invite.dto";
import { UserQueryDto } from "./dto/user-query.dto";
import { UserResponseDto } from "./dto/user-response.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { ChangeEmailDto } from "./dto/change-email.dto";
import { ConfirmEmailDto } from "./dto/confirm-email.dto";
import { SessionData } from "../common/types/session.interface";
import { Public } from "../common/decorators/public.decorator";
import { PaginatedResponseDto } from "../common/dto/paginated-response.dto";

@ApiTags("users")
@ApiCookieAuth("session")
@UseGuards(AuthGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: "List all registered users (Admin only)" })
  @ApiResponse({ status: 200, description: "Paginated list of users" })
  @UseGuards(AdminGuard)
  @Get()
  async findAll(@Query() query: UserQueryDto): Promise<PaginatedResponseDto<UserResponseDto>> {
    const result = await this.usersService.findAll(query);
    const serialized = plainToInstance(UserResponseDto, result.data, {
      excludeExtraneousValues: true,
    });
    return new PaginatedResponseDto(
      serialized,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @ApiOperation({ summary: "Invite a new user with optional role (Admin only)" })
  @ApiResponse({ status: 201, description: "Invitation token generated" })
  @ApiResponse({ status: 409, description: "Active invite or registered user already exists" })
  @ApiResponse({ status: 502, description: "Failed to send invitation email" })
  @UseGuards(AdminGuard)
  @Post("invite")
  async invite(@Body() inviteDto: InviteDto) {
    const invite = await this.usersService.invite(
      inviteDto.email,
      inviteDto.role,
      inviteDto.teamId,
    );

    if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test") {
      return {
        email: invite.email,
        role: invite.role,
        teamId: invite.teamId,
        expiresAt: invite.expiresAt,
      };
    }

    return invite;
  }

  @ApiOperation({ summary: "Get currently authenticated user profile" })
  @ApiResponse({ status: 200, description: "Current user profile", type: UserResponseDto })
  @Get("me")
  getCurrentUser(@CurrentUser() currentUser: User): UserResponseDto {
    return plainToInstance(UserResponseDto, currentUser, {
      excludeExtraneousValues: true,
    });
  }

  @ApiOperation({ summary: "Update currently authenticated user profile" })
  @ApiResponse({ status: 200, description: "Updated user profile", type: UserResponseDto })
  @Patch("me")
  async update(
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: User,
  ): Promise<UserResponseDto> {
    await this.usersService.update(user.userId, updateUserDto);
    const updatedUser = await this.usersService.findOne({
      userId: user.userId,
    });
    return plainToInstance(UserResponseDto, updatedUser, {
      excludeExtraneousValues: true,
    });
  }

  @ApiOperation({ summary: "Change authenticated user's password" })
  @ApiResponse({ status: 200, description: "Password successfully updated" })
  @ApiResponse({ status: 400, description: "New password same as current or invalid" })
  @ApiResponse({ status: 401, description: "Current password incorrect" })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Patch("me/password")
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: User,
    @Session() session: SessionData,
  ) {
    return this.usersService.changePassword(user.userId, dto, session);
  }

  @ApiOperation({ summary: "Request change of authenticated user's email address" })
  @ApiResponse({ status: 200, description: "Verification email sent to new address" })
  @ApiResponse({ status: 400, description: "New email same as current" })
  @ApiResponse({ status: 401, description: "Current password incorrect" })
  @ApiResponse({ status: 409, description: "Email address is already in use" })
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("me/email")
  async requestEmailChange(
    @Body() dto: ChangeEmailDto,
    @CurrentUser() user: User,
  ) {
    return this.usersService.requestEmailChange(user.userId, dto);
  }

  @ApiOperation({ summary: "Confirm email change using token" })
  @ApiResponse({ status: 200, description: "Email successfully updated" })
  @ApiResponse({ status: 400, description: "Invalid or expired token" })
  @ApiResponse({ status: 409, description: "Email address already taken" })
  @Public()
  @Post("me/email/confirm")
  @HttpCode(HttpStatus.OK)
  async confirmEmailChange(@Body() dto: ConfirmEmailDto) {
    return this.usersService.confirmEmailChange(dto);
  }


  @ApiOperation({ summary: "Get user details by ID (Admin only)" })
  @ApiResponse({ status: 200, description: "User profile", type: UserResponseDto })
  @ApiResponse({ status: 404, description: "User not found" })
  @UseGuards(AdminGuard)
  @Get(":userId")
  async findOne(@Param("userId", ParseIntPipe) userId: number): Promise<UserResponseDto> {
    const user = await this.usersService.findOne({ userId });
    return plainToInstance(UserResponseDto, user, {
      excludeExtraneousValues: true,
    });
  }

  @ApiOperation({ summary: "Soft delete a user (Admin only, self-deletion and last admin protected)" })
  @ApiResponse({ status: 200, description: "User deleted" })
  @ApiResponse({ status: 400, description: "Cannot delete self or last remaining admin" })
  @ApiResponse({ status: 404, description: "User not found" })
  @UseGuards(AdminGuard)
  @Delete(":userId")
  async remove(
    @Param("userId", ParseIntPipe) userId: number,
    @CurrentUser() admin: User,
  ) {
    await this.usersService.remove(userId, admin.userId);
  }
}
