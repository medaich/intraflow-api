import { plainToInstance } from 'class-transformer';
import { TaskResponseDto } from './task-response.dto';
import { CommentResponseDto } from './comment-response.dto';
import { TaskStatus } from '../entities/task.entity';

describe('Task and Comment Response DTO Serialization (Password Non-Leakage)', () => {
  it('TaskResponseDto exposes submittedAt and completedAt, excludes endedAt, and strips password from assignedTo', () => {
    const now = new Date();
    const taskData = {
      taskId: 1,
      name: 'Integration Task',
      description: 'Testing DTO serialization',
      startDate: now,
      endDate: now,
      startedAt: now,
      submittedAt: now,
      completedAt: now,
      status: TaskStatus.COMPLETED,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      assignedTo: {
        userId: 5,
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'should_never_be_serialized',
      },
    };

    const dto = plainToInstance(TaskResponseDto, taskData, {
      excludeExtraneousValues: true,
    });

    expect((dto as Record<string, unknown>).endedAt).toBeUndefined();
    expect(dto.submittedAt).toBeDefined();
    expect(dto.completedAt).toBeDefined();
    expect(dto.assignedTo?.userId).toBe(5);
    expect((dto.assignedTo as Record<string, unknown>).password).toBeUndefined();
  });

  it('CommentResponseDto strictly strips password from nested user', () => {
    const now = new Date();
    const commentData = {
      commentId: 101,
      content: 'Code review remarks',
      createdAt: now,
      updatedAt: now,
      user: {
        userId: 7,
        name: 'Author Name',
        password: 'leaked_password_hash',
      },
    };

    const dto = plainToInstance(CommentResponseDto, commentData, {
      excludeExtraneousValues: true,
    });

    expect(dto.commentId).toBe(101);
    expect(dto.user?.userId).toBe(7);
    expect(dto.user?.name).toBe('Author Name');
    expect((dto.user as Record<string, unknown>).password).toBeUndefined();
  });
});
