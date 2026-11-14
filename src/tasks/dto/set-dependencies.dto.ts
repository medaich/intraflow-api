import { ArrayUnique, IsArray, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetDependenciesDto {
  @ApiProperty({ example: [1, 2], description: 'Array of task IDs that this task depends on' })
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  dependsOn: number[];
}
