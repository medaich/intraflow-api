import { ConflictException } from '@nestjs/common';
import { TaskStatus } from './entities/task.entity';

export const ALLOWED_TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  [TaskStatus.UNASSIGNED]: [TaskStatus.PENDING],
  [TaskStatus.PENDING]: [TaskStatus.UNASSIGNED, TaskStatus.IN_PROGRESS],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.IN_REVIEW],
  [TaskStatus.IN_REVIEW]: [TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS],
  [TaskStatus.COMPLETED]: [],
};

export function assertTaskTransition(currentStatus: TaskStatus, targetStatus: TaskStatus): void {
  const allowed = ALLOWED_TASK_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new ConflictException(
      `Illegal task status transition from '${currentStatus}' to '${targetStatus}'. Allowed: [${allowed.join(', ')}]`,
    );
  }
}
