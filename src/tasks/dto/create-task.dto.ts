import { Type } from "class-transformer";
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { TaskPriority } from "../entities/task.entity";

export class CreateTaskDto {
  @ApiProperty({ description: "Task name" })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: "Detailed description", nullable: true })
  @IsOptional()
  @IsString()
  description: string | null;

  @ApiProperty({ description: "Task start date (ISO string)" })
  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @ApiProperty({ description: "Task end date (ISO string)" })
  @Type(() => Date)
  @IsDate()
  endDate: Date;

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;
}
