import { IsInt, IsOptional, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetProjectTeamDto {
  @ApiPropertyOptional({ example: 1, nullable: true })
  @IsOptional()
  @ValidateIf((object, value) => value !== null)
  @IsInt()
  teamId: number | null;
}
