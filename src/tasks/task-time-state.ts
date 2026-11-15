import { TaskStatus } from "./entities/task.entity";

export enum TaskTimeState {
  DONE = "DONE",
  OVERDUE = "OVERDUE",
  UPCOMING = "UPCOMING",
  ACTIVE = "ACTIVE",
}

export function computeTaskTimeState(
  status: TaskStatus,
  startDate: Date | string | null,
  endDate: Date | string | null,
  now: Date,
): TaskTimeState {
  if (status === TaskStatus.COMPLETED) {
    return TaskTimeState.DONE;
  }

  const nowMs = now.getTime();

  if (endDate && new Date(endDate).getTime() < nowMs) {
    return TaskTimeState.OVERDUE;
  }

  if (startDate && new Date(startDate).getTime() > nowMs) {
    return TaskTimeState.UPCOMING;
  }

  return TaskTimeState.ACTIVE;
}
