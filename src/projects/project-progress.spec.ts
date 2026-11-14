import { TaskStatus } from '../tasks/entities/task.entity';
import { ProjectStatus } from './entities/project.entity';
import { calculateProjectProgress, checkProjectIsOverdue } from './project-progress';

describe('Project Progress and Overdue Logic', () => {
  describe('calculateProjectProgress', () => {
    it('returns 0% progress when a project has 0 tasks', () => {
      const progress = calculateProjectProgress([]);
      expect(progress).toEqual({
        completed: 0,
        total: 0,
        percent: 0,
      });
    });

    it('calculates 50% progress for 2 completed out of 4 tasks', () => {
      const tasks = [
        { status: TaskStatus.COMPLETED },
        { status: TaskStatus.COMPLETED },
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.PENDING },
      ];
      const progress = calculateProjectProgress(tasks);
      expect(progress).toEqual({
        completed: 2,
        total: 4,
        percent: 50,
      });
    });

    it('rounds percentage correctly for 1 completed out of 3 tasks (33%)', () => {
      const tasks = [
        { status: TaskStatus.COMPLETED },
        { status: TaskStatus.IN_PROGRESS },
        { status: TaskStatus.UNASSIGNED },
      ];
      const progress = calculateProjectProgress(tasks);
      expect(progress).toEqual({
        completed: 1,
        total: 3,
        percent: 33,
      });
    });

    it('returns 100% when all tasks are completed', () => {
      const tasks = [
        { status: TaskStatus.COMPLETED },
        { status: TaskStatus.COMPLETED },
      ];
      const progress = calculateProjectProgress(tasks);
      expect(progress).toEqual({
        completed: 2,
        total: 2,
        percent: 100,
      });
    });
  });

  describe('checkProjectIsOverdue', () => {
    const fixedNow = new Date('2026-11-14T12:00:00Z');
    const pastDate = new Date('2026-11-10T12:00:00Z');
    const futureDate = new Date('2026-11-20T12:00:00Z');

    it('returns false if endDate is null', () => {
      expect(checkProjectIsOverdue(null, ProjectStatus.ACTIVE, fixedNow)).toBe(false);
    });

    it('returns false if endDate is in the future', () => {
      expect(checkProjectIsOverdue(futureDate, ProjectStatus.ACTIVE, fixedNow)).toBe(false);
    });

    it('returns true if endDate is in the past and project is ACTIVE', () => {
      expect(checkProjectIsOverdue(pastDate, ProjectStatus.ACTIVE, fixedNow)).toBe(true);
    });

    it('returns true if endDate is in the past and project is ON_HOLD', () => {
      expect(checkProjectIsOverdue(pastDate, ProjectStatus.ON_HOLD, fixedNow)).toBe(true);
    });

    it('returns false if endDate is in the past but project is COMPLETED', () => {
      expect(checkProjectIsOverdue(pastDate, ProjectStatus.COMPLETED, fixedNow)).toBe(false);
    });

    it('returns false if endDate is in the past but project is ARCHIVED', () => {
      expect(checkProjectIsOverdue(pastDate, ProjectStatus.ARCHIVED, fixedNow)).toBe(false);
    });
  });
});
