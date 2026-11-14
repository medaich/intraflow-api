import { IsEnum, IsInt, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TeamMemberRole } from '../entities/team-membership.entity';

export class AddMemberDto {
  @ApiProperty({ example: 2 })
  @IsNotEmpty()
  @IsInt()
  userId: number;

  @ApiPropertyOptional({ enum: TeamMemberRole, default: TeamMemberRole.MEMBER })
  @IsOptional()
  @IsEnum(TeamMemberRole)
  role?: TeamMemberRole;
}
