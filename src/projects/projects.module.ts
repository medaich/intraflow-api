import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './entities/project.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { Team } from '../teams/entities/team.entity';
import { Task } from '../tasks/entities/task.entity';
import { UsersModule } from '../users/users.module';
import { TasksModule } from '../tasks/tasks.module';
import { AccessPolicyService } from '../auth/policy/access-policy.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, Team, Task]),
    UsersModule,
    TasksModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, AccessPolicyService],
  exports: [ProjectsService, TypeOrmModule],
})
export class ProjectsModule {}
