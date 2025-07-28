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
import { CurrentUser } from "./decorators/current-user.decorator";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersService } from "./users.service";
import { User } from "./entities/user.entity";
import { AuthGuard } from "src/guards/auth.guard";
import { AdminGuard } from "src/guards/admin-auth.guard";
import { InviteDto } from "./dto/invite.dto";

@UseGuards(AuthGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(AdminGuard)
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  @UseGuards(AdminGuard)
  @Post("invite")
  async invite(@Body() inviteDto: InviteDto) {
    return this.usersService.invite(inviteDto.email);
  }

  @UseGuards(AdminGuard)
  @Get(":userId")
  async findOne(@Param("userId", ParseIntPipe) userId: number) {
    const user = await this.usersService.findOne({ userId });
    return { ...user, password: undefined };
  }

  @UseGuards(AdminGuard)
  @Delete(":userId")
  async remove(@Param("userId", ParseIntPipe) userId: number) {
    await this.usersService.remove(userId);
  }

  @Get("me")
  getCurrentUser(@CurrentUser() currentUser: User) {
    return currentUser;
  }

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
}
