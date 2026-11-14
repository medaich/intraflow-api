import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasksService } from './tasks.service';
import { Task, TaskStatus } from './entities/task.entity';
import { User } from '../users/entities/user.entity';
import { Comment } from './entities/comment.entity';
import { Project } from '../projects/entities/project.entity';
import { AccessPolicyService } from '../auth/policy/access-policy.service';

describe('TasksService (Persistence, Lifecycle, State Machine & Authorization)', () => {
  let tasksService: TasksService;
  let tasksRepo: jest.Mocked<Partial<Repository<Task>>>;
  let usersRepo: jest.Mocked<Partial<Repository<User>>>;
  let commentRepo: jest.Mocked<Partial<Repository<Comment>>>;
  let projectRepo: jest.Mocked<Partial<Repository<Project>>>;

  beforeEach(async () => {
    projectRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };
    tasksRepo = {
      save: jest.fn().mockImplementation((t: Task) => Promise.resolve(t)),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      find: jest.fn(),
      softDelete: jest.fn().mockResolvedValue({ raw: [], affected: 1 }),
    };

    usersRepo = {
      findOne: jest.fn().mockResolvedValue(new User({ userId: 5 })),
      findOneBy: jest.fn(),
    };

    commentRepo = {
      save: jest.fn().mockImplementation((c: Comment) => Promise.resolve(c)),
      findOne: jest.fn(),
      find: jest.fn(),
      softDelete: jest.fn().mockResolvedValue({ raw: [], affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        AccessPolicyService,
        { provide: getRepositoryToken(Task), useValue: tasksRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(Comment), useValue: commentRepo },
        { provide: getRepositoryToken(Project), useValue: projectRepo },
      ],
    }).compile();

    tasksService = module.get<TasksService>(TasksService);
  });

  describe('Task State Transitions & Persistence', () => {
    it('validate() persists status COMPLETED and sets completedAt', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.IN_REVIEW,
        startedAt: new Date('2026-01-01'),
        submittedAt: new Date('2026-01-02'),
        completedAt: null,
      });

      tasksRepo.findOne!.mockResolvedValue(task);

      const result = await tasksService.validate(1);

      expect(tasksRepo.save).toHaveBeenCalledWith(task);
      expect(result.status).toBe(TaskStatus.COMPLETED);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('submit() sets submittedAt and does not overwrite startedAt', async () => {
      const initialStartedAt = new Date('2026-01-01T10:00:00Z');
      const task = new Task({
        taskId: 1,
        status: TaskStatus.IN_PROGRESS,
        startedAt: initialStartedAt,
        submittedAt: null,
        assignedTo: new User({ userId: 42 }),
      });

      tasksRepo.findOne!.mockResolvedValue(task);

      const result = await tasksService.submit(1, 42);

      expect(tasksRepo.save).toHaveBeenCalledWith(task);
      expect(result.startedAt).toEqual(initialStartedAt);
      expect(result.submittedAt).toBeInstanceOf(Date);
      expect(result.status).toBe(TaskStatus.IN_REVIEW);
    });

    it('assign() loads entity and persists relation via save()', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.UNASSIGNED,
        assignedTo: null,
      });
      const user = new User({ userId: 5 });

      tasksRepo.findOne!.mockResolvedValue(task);
      usersRepo.findOneBy!.mockResolvedValue(user);

      await tasksService.assign(1, 5);

      expect(tasksRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 1,
          status: TaskStatus.PENDING,
          assignedTo: expect.objectContaining({ userId: 5 }),
        }),
      );
    });

    it('unassign() loads entity, clears assignee and persists via save()', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.PENDING,
        assignedTo: new User({ userId: 5 }),
      });

      tasksRepo.findOne!.mockResolvedValue(task);

      await tasksService.unassign(1);

      expect(tasksRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 1,
          status: TaskStatus.UNASSIGNED,
          assignedTo: null,
        }),
      );
    });
  });

  describe('Service-Level State Machine Enforcement (409 ConflictException)', () => {
    it('start on a non-PENDING task returns 409', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.IN_PROGRESS,
        assignedTo: new User({ userId: 42 }),
      });
      tasksRepo.findOne!.mockResolvedValue(task);

      await expect(tasksService.start(1, 42)).rejects.toThrow(ConflictException);
    });

    it('assign on a non-UNASSIGNED task returns 409', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.IN_PROGRESS,
        assignedTo: new User({ userId: 42 }),
      });
      tasksRepo.findOne!.mockResolvedValue(task);

      await expect(tasksService.assign(1, 99)).rejects.toThrow(ConflictException);
    });

    it('submit twice (task already IN_REVIEW) returns 409', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.IN_REVIEW,
        assignedTo: new User({ userId: 42 }),
      });
      tasksRepo.findOne!.mockResolvedValue(task);

      await expect(tasksService.submit(1, 42)).rejects.toThrow(ConflictException);
    });

    it('validate on a non-IN_REVIEW task returns 409', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.IN_PROGRESS,
      });
      tasksRepo.findOne!.mockResolvedValue(task);

      await expect(tasksService.validate(1)).rejects.toThrow(ConflictException);
    });
  });

  describe('Relations Verification in Query Execution', () => {
    it('findOne loads assignedTo relation', async () => {
      tasksRepo.findOne!.mockResolvedValue(new Task({ taskId: 1 }));
      await tasksService.findOne(1);
      expect(tasksRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 1 },
          relations: expect.arrayContaining(['assignedTo']),
        }),
      );
    });

    it('getComment loads user and task relations with expected selection', async () => {
      commentRepo.findOne!.mockResolvedValue(
        new Comment({ commentId: 10, task: new Task({ taskId: 1 }) }),
      );
      await tasksService.getComment(10, 1);
      expect(commentRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { commentId: 10 },
          relations: ['user', 'task'],
        }),
      );
    });
  });

  describe('Comment Authorization Matrix (Positive & Negative)', () => {
    it('owner can edit own comment', async () => {
      const comment = new Comment({
        commentId: 10,
        content: 'Original content',
        user: new User({ userId: 42 }),
        task: new Task({ taskId: 1 }),
      });
      commentRepo.findOne!.mockResolvedValue(comment);

      const result = await tasksService.updateComment(1, 10, 42, 'Updated content');
      expect(result.content).toBe('Updated content');
      expect(commentRepo.save).toHaveBeenCalled();
    });

    it('owner can delete own comment', async () => {
      const comment = new Comment({
        commentId: 10,
        user: new User({ userId: 42 }),
        task: new Task({ taskId: 1 }),
      });
      commentRepo.findOne!.mockResolvedValue(comment);

      await expect(tasksService.removeComment(1, 10, 42, false)).resolves.toBeUndefined();
      expect(commentRepo.softDelete).toHaveBeenCalledWith(10);
    });

    it('admin can edit their own comment', async () => {
      const adminId = 1;
      const comment = new Comment({
        commentId: 15,
        content: 'Admin comment',
        user: new User({ userId: adminId }),
        task: new Task({ taskId: 1 }),
      });
      commentRepo.findOne!.mockResolvedValue(comment);

      const result = await tasksService.updateComment(1, 15, adminId, 'Admin updated content');
      expect(result.content).toBe('Admin updated content');
    });

    it('admin can delete any comment (even authored by another user)', async () => {
      const adminId = 1;
      const comment = new Comment({
        commentId: 20,
        user: new User({ userId: 99 }),
        task: new Task({ taskId: 1 }),
      });
      commentRepo.findOne!.mockResolvedValue(comment);

      await expect(tasksService.removeComment(1, 20, adminId, true)).resolves.toBeUndefined();
      expect(commentRepo.softDelete).toHaveBeenCalledWith(20);
    });

    it('non-admin cannot delete someone elses comment', async () => {
      const comment = new Comment({
        commentId: 20,
        user: new User({ userId: 99 }),
        task: new Task({ taskId: 1 }),
      });
      commentRepo.findOne!.mockResolvedValue(comment);

      await expect(tasksService.removeComment(1, 20, 42, false)).rejects.toThrow(ForbiddenException);
    });

    it('user cannot edit someone elses comment', async () => {
      const comment = new Comment({
        commentId: 10,
        user: new User({ userId: 99 }),
        task: new Task({ taskId: 1 }),
      });
      commentRepo.findOne!.mockResolvedValue(comment);

      await expect(tasksService.updateComment(1, 10, 42, 'Hacked')).rejects.toThrow(ForbiddenException);
    });

    it('comment with wrong taskId returns 404 NotFoundException', async () => {
      const comment = new Comment({
        commentId: 10,
        user: new User({ userId: 42 }),
        task: new Task({ taskId: 999 }),
      });
      commentRepo.findOne!.mockResolvedValue(comment);

      await expect(tasksService.updateComment(1, 10, 42, 'Content')).rejects.toThrow(NotFoundException);
    });
  });
});
