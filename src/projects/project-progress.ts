import { TaskStatus } from '../tasks/entities/task.entity';
import { ProjectStatus } from './entities/project.entity';

export interface ProjectProgress {
  completed: number;
  total: number;
  percent: number;
}

/**
 * Calculates progress for a project based on its tasks.
 * Derived at query time, never stored in the database.
 */
export function calculateProjectProgress(
  tasks: Array<{ status: TaskStatus }>,
): ProjectProgress {
  const total = tasks.length;
  if (total === 0) {
    return { completed: 0, total: 0, percent: 0 };
  }

  const completed = tasks.filter((t) => t.status === TaskStatus.COMPLETED).length;
  const percent = Math.round((completed / total) * 100);

  return { completed, total, percent };
}

/**
 * Checks whether a project is overdue.
 * True when endDate has passed and status is neither COMPLETED nor ARCHIVED.
 */
export function checkProjectIsOverdue(
  endDate: Date | null,
  status: ProjectStatus,
  now: Date = new Date(),
): boolean {
  if (!endDate) {
    return false;
  }

  if (status === ProjectStatus.COMPLETED || status === ProjectStatus.ARCHIVED) {
    return false;
  }

  return new Date(now) > new Date(endDate);
}
