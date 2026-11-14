import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Team } from './entities/team.entity';
import { TeamMembership } from './entities/team-membership.entity';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { UsersModule } from '../users/users.module';
import { User } from '../users/entities/user.entity';
import { Project } from '../projects/entities/project.entity';
import { Task } from '../tasks/entities/task.entity';
import { Comment } from '../tasks/entities/comment.entity';
import { AccessPolicyService } from '../auth/policy/access-policy.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Team, TeamMembership, User, Project, Task, Comment]),
    UsersModule,
  ],
  controllers: [TeamsController],
  providers: [TeamsService, AccessPolicyService],
  exports: [TeamsService, AccessPolicyService, TypeOrmModule],
})
export class TeamsModule {}
