import { Exclude, Expose, Type } from 'class-transformer';
import { TeamMemberResponseDto } from './team-member-response.dto';

@Exclude()
export class TeamResponseDto {
  @Expose()
  teamId: number;

  @Expose()
  name: string;

  @Expose()
  description: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  @Type(() => TeamMemberResponseDto)
  members?: TeamMemberResponseDto[];
}
