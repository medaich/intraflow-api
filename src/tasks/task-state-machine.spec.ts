import { ConflictException } from '@nestjs/common';
import { assertTaskTransition } from './task-state-machine';
import { TaskStatus } from './entities/task.entity';

describe('Task State Machine (Transitions & Concurrency Protection)', () => {
  it('allows valid lifecycle transitions', () => {
    expect(() => assertTaskTransition(TaskStatus.UNASSIGNED, TaskStatus.PENDING)).not.toThrow();
    expect(() => assertTaskTransition(TaskStatus.PENDING, TaskStatus.IN_PROGRESS)).not.toThrow();
    expect(() => assertTaskTransition(TaskStatus.PENDING, TaskStatus.UNASSIGNED)).not.toThrow();
    expect(() => assertTaskTransition(TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW)).not.toThrow();
    expect(() => assertTaskTransition(TaskStatus.IN_REVIEW, TaskStatus.COMPLETED)).not.toThrow();
    expect(() => assertTaskTransition(TaskStatus.IN_REVIEW, TaskStatus.IN_PROGRESS)).not.toThrow();
  });

  it('throws ConflictException (409) on illegal transitions', () => {
    expect(() => assertTaskTransition(TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS)).toThrow(ConflictException);
    expect(() => assertTaskTransition(TaskStatus.UNASSIGNED, TaskStatus.IN_PROGRESS)).toThrow(ConflictException);
    expect(() => assertTaskTransition(TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED)).toThrow(ConflictException);
    expect(() => assertTaskTransition(TaskStatus.COMPLETED, TaskStatus.COMPLETED)).toThrow(ConflictException);
    expect(() => assertTaskTransition(TaskStatus.UNASSIGNED, TaskStatus.IN_REVIEW)).toThrow(ConflictException);
  });
});
