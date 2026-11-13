import { IsInt, IsNotEmpty } from 'class-validator';

export class AssignTaskDto {
  @IsNotEmpty()
  @IsInt()
  userId: number;
}
