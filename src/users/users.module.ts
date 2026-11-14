import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { Task } from "../tasks/entities/task.entity";
import { Comment } from "../tasks/entities/comment.entity";
import { ConfigModule } from "@nestjs/config";
import { Invited } from "./entities/invited.entity";
import { AuthGuard } from "src/guards/auth.guard";
import { AdminGuard } from "src/guards/admin-auth.guard";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Task, Comment, Invited]),
    ConfigModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    AuthGuard,
    AdminGuard,
  ],
  exports: [UsersService, AuthGuard, AdminGuard],
})
export class UsersModule {}
