import { Exclude, Expose, Type } from "class-transformer";
import { TaskStatus } from "../entities/task.entity";

@Exclude()
export class TaskResponseDto {
  @Expose()
  taskId: number;

  @Expose()
  @Type(() => OnlyUserIdDto)
  assignedTo: OnlyUserIdDto | null;

  @Expose()
  name: string;

  @Expose()
  description: string | null;

  @Expose()
  startDate: Date;

  @Expose()
  endDate: Date;

  @Expose()
  startedAt: Date | null;

  @Expose()
  submittedAt: Date | null;

  @Expose()
  completedAt: Date | null;

  @Expose()
  status: TaskStatus;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date | null;

  @Exclude()
  deletedAt: Date | null;
}

export class OnlyUserIdDto {
  @Expose()
  userId: number;
}
