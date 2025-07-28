import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Task } from "src/tasks/entities/task.entity";
import { User } from "src/users/entities/user.entity";
import { Comment } from "src/tasks/entities/comment.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Task, User, Comment])],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
