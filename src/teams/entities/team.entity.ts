import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TeamMembership } from './team-membership.entity';
import { Project } from '../../projects/entities/project.entity';

@Entity('teams')
export class Team {
  constructor(team?: Partial<Team>) {
    if (team) {
      Object.assign(this, team);
    }
  }

  @PrimaryGeneratedColumn({ name: 'team_id' })
  teamId: number;

  @Column({ unique: true, length: 255 })
  name: string;

  @Column('text', { nullable: true })
  description: string | null;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 6,
    name: 'created_at',
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamp',
    precision: 6,
    name: 'updated_at',
  })
  updatedAt: Date;

  @DeleteDateColumn({
    type: 'timestamp',
    precision: 6,
    name: 'deleted_at',
    nullable: true,
  })
  deletedAt: Date | null;

  @OneToMany(() => TeamMembership, (membership) => membership.team)
  members: TeamMembership[];

  @OneToMany(() => Project, (project) => project.team)
  projects: Project[];
}
