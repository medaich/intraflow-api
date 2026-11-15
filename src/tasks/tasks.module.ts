import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Task } from "./entities/task.entity";
import { User } from "../users/entities/user.entity";
import { Comment } from "./entities/comment.entity";
import { Project } from "../projects/entities/project.entity";
import { Attachment } from "./entities/attachment.entity";
import { UsersModule } from "../users/users.module";
import { AccessPolicyService } from "../auth/policy/access-policy.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, User, Comment, Project, Attachment]),
    UsersModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, AccessPolicyService],
  exports: [TasksService, TypeOrmModule],
})
export class TasksModule {}

