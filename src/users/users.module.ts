import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { Task } from "../tasks/entities/task.entity";
import { Comment } from "../tasks/entities/comment.entity";
import { CurrentUserInterceptor } from "./interceptors/current-user.interceptor";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { Invited } from "./entities/invited.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Task, Comment, Invited]),
    ConfigModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    {
      useClass: CurrentUserInterceptor,
      provide: APP_INTERCEPTOR,
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
