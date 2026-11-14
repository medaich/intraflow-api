import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { Task } from "../tasks/entities/task.entity";
import { Comment } from "../tasks/entities/comment.entity";
import { ConfigModule } from "@nestjs/config";
import { Invited } from "./entities/invited.entity";
import { Team } from "../teams/entities/team.entity";
import { TeamMembership } from "../teams/entities/team-membership.entity";
import { AuthGuard } from "../guards/auth.guard";
import { AdminGuard } from "../guards/admin-auth.guard";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Task, Comment, Invited, Team, TeamMembership]),
    ConfigModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    AuthGuard,
    AdminGuard,
  ],
  exports: [UsersService, AuthGuard, AdminGuard, TypeOrmModule],
})
export class UsersModule {}
