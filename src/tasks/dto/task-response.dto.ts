import { Exclude, Expose, Type } from "class-transformer";
import { TaskPriority, TaskStatus } from "../entities/task.entity";
import { TaskTimeState } from "../task-time-state";

@Exclude()
export class TaskAssigneeDto {
  @Expose()
  userId: number;

  @Expose()
  name: string;
}

@Exclude()
export class TaskResponseDto {
  @Expose()
  taskId: number;

  @Expose()
  projectId: number | null;

  @Expose()
  @Type(() => TaskAssigneeDto)
  assignedTo: TaskAssigneeDto | null;

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
  priority: TaskPriority;

  @Expose()
  timeState: TaskTimeState;

  @Expose()
  dependsOn: number[];

  @Expose()
  blockedBy: number[];

  @Expose()
  isBlocked: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date | null;

  @Exclude()
  deletedAt: Date | null;
}
