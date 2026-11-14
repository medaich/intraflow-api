import { Exclude, Expose, Type } from 'class-transformer';
import { TeamMemberRole } from '../entities/team-membership.entity';

@Exclude()
export class TeamMemberUserDto {
  @Expose()
  userId: number;

  @Expose()
  name: string;

  @Expose()
  role?: string;
}

@Exclude()
export class TeamMemberResponseDto {
  @Expose()
  id: number;

  @Expose()
  userId: number;

  @Expose()
  teamId: number;

  @Expose()
  role: TeamMemberRole;

  @Expose()
  createdAt: Date;

  @Expose()
  @Type(() => TeamMemberUserDto)
  user?: TeamMemberUserDto;
}
