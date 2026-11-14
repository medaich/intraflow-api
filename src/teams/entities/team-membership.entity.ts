import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Team } from './team.entity';

export enum TeamMemberRole {
  MEMBER = 'MEMBER',
  MODERATOR = 'MODERATOR',
}

@Entity('team_memberships')
@Unique('UQ_team_memberships_user_id', ['userId'])
export class TeamMembership {
  constructor(membership?: Partial<TeamMembership>) {
    if (membership) {
      Object.assign(this, membership);
    }
  }

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @Column({ name: 'team_id' })
  teamId: number;

  @Column({
    type: 'enum',
    enum: TeamMemberRole,
    default: TeamMemberRole.MEMBER,
  })
  role: TeamMemberRole;

  @CreateDateColumn({
    type: 'timestamp',
    precision: 6,
    name: 'created_at',
  })
  createdAt: Date;

  @OneToOne(() => User, (user) => user.membership, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Team, (team) => team.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;
}
