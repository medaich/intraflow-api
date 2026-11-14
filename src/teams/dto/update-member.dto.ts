import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TeamMemberRole } from '../entities/team-membership.entity';

export class UpdateMemberDto {
  @ApiProperty({ enum: TeamMemberRole, example: TeamMemberRole.MODERATOR })
  @IsNotEmpty()
  @IsEnum(TeamMemberRole)
  role: TeamMemberRole;
}
