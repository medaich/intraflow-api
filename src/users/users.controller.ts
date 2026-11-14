import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from "@nestjs/swagger";
import { CurrentUser } from "./decorators/current-user.decorator";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersService } from "./users.service";
import { User } from "./entities/user.entity";
import { AuthGuard } from "src/guards/auth.guard";
import { AdminGuard } from "src/guards/admin-auth.guard";
import { InviteDto } from "./dto/invite.dto";

@ApiTags("users")
@ApiCookieAuth("session")
@UseGuards(AuthGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: "List all registered users (Admin only)" })
  @ApiResponse({ status: 200, description: "List of users" })
  @UseGuards(AdminGuard)
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  @ApiOperation({ summary: "Invite a new user with optional role (Admin only)" })
  @ApiResponse({ status: 201, description: "Invitation token generated" })
  @ApiResponse({ status: 409, description: "Active invite or registered user already exists" })
  @UseGuards(AdminGuard)
  @Post("invite")
  async invite(@Body() inviteDto: InviteDto) {
    return this.usersService.invite(inviteDto.email, inviteDto.role, inviteDto.teamId);
  }

  @ApiOperation({ summary: "Get currently authenticated user profile" })
  @ApiResponse({ status: 200, description: "Current user profile" })
  @Get("me")
  getCurrentUser(@CurrentUser() currentUser: User) {
    return currentUser;
  }

  @ApiOperation({ summary: "Update currently authenticated user profile" })
  @ApiResponse({ status: 200, description: "Updated user profile" })
  @Patch("me")
  async update(
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: User,
  ) {
    await this.usersService.update(user.userId, updateUserDto);
    const updatedUser = await this.usersService.findOne({
      userId: user.userId,
    });
    return { ...updatedUser, password: undefined };
  }

  @ApiOperation({ summary: "Get user details by ID (Admin only)" })
  @ApiResponse({ status: 200, description: "User profile" })
  @ApiResponse({ status: 404, description: "User not found" })
  @UseGuards(AdminGuard)
  @Get(":userId")
  async findOne(@Param("userId", ParseIntPipe) userId: number) {
    const user = await this.usersService.findOne({ userId });
    return { ...user, password: undefined };
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
