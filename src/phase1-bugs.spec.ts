import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { TasksService } from './tasks/tasks.service';
import { Task, TaskStatus } from './tasks/entities/task.entity';
import { User, UserRole } from './users/entities/user.entity';
import { Comment } from './tasks/entities/comment.entity';
import { TaskResponseDto } from './tasks/dto/task-response.dto';
import { AuthGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin-auth.guard';
import { plainToInstance } from 'class-transformer';
import { assertTaskTransition } from './tasks/task-state-machine';

describe('Phase 1 Bug Fix Tests', () => {
  describe('Bug 1: Route Shadowing on GET /users/me', () => {
    let app: INestApplication;
    const mockUsersService = {
      findOne: jest.fn().mockImplementation(({ userId }) => {
        return Promise.resolve({ userId, name: 'Target User' });
      }),
      findAll: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      invite: jest.fn(),
    };

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [UsersController],
        providers: [{ provide: UsersService, useValue: mockUsersService }],
      })
        .overrideGuard(AuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(AdminGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ transform: true }));
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('GET /users/me correctly reaches me handler instead of :userId', async () => {
      const res = await request(app.getHttpServer()).get('/users/me');
      expect(res.status).toBe(200);
    });
  });

  describe('Bug 2 & 3: TasksService validate() and submit() fixes', () => {
    let tasksService: TasksService;
    let mockTasksRepo: any;
    let mockUsersRepo: any;
    let mockCommentRepo: any;

    beforeEach(() => {
      mockTasksRepo = {
        save: jest.fn().mockImplementation((t: any) => Promise.resolve(t)),
        update: jest.fn(),
        findOne: jest.fn(),
        findOneBy: jest.fn(),
        find: jest.fn(),
        softDelete: jest.fn(),
      };
      mockUsersRepo = {
        findOneBy: jest.fn(),
      };
      mockCommentRepo = {
        save: jest.fn(),
        update: jest.fn(),
        findOne: jest.fn(),
        find: jest.fn(),
        softDelete: jest.fn(),
      };

      tasksService = new TasksService();
      (tasksService as any).tasksRepo = mockTasksRepo;
      (tasksService as any).usersRepo = mockUsersRepo;
      (tasksService as any).commentRepo = mockCommentRepo;
    });

    it('Bug 2: validate() persists status COMPLETED and sets completedAt', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.IN_REVIEW,
        startedAt: new Date('2026-01-01'),
        submittedAt: new Date('2026-01-02'),
        completedAt: null,
      });

      mockTasksRepo.findOne.mockResolvedValue(task);

      const result = await tasksService.validate(1);

      expect(mockTasksRepo.save).toHaveBeenCalledWith(task);
      expect(result.status).toBe(TaskStatus.COMPLETED);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('Bug 3: submit() sets submittedAt and does not overwrite startedAt', async () => {
      const initialStartedAt = new Date('2026-01-01T10:00:00Z');
      const task = new Task({
        taskId: 1,
        status: TaskStatus.IN_PROGRESS,
        startedAt: initialStartedAt,
        submittedAt: null,
        assignedTo: new User({ userId: 42 }),
      });

      mockTasksRepo.findOne.mockResolvedValue(task);

      const result = await tasksService.submit(1, 42);

      expect(mockTasksRepo.save).toHaveBeenCalledWith(task);
      expect(result.startedAt).toEqual(initialStartedAt);
      expect(result.submittedAt).toBeInstanceOf(Date);
      expect(result.status).toBe(TaskStatus.IN_REVIEW);
    });
  });

  describe('Bug 4: Comment IDOR and Task Verification', () => {
    let tasksService: TasksService;
    let mockCommentRepo: any;
    let mockTasksRepo: any;

    beforeEach(() => {
      mockTasksRepo = {
        findOne: jest.fn(),
      };
      mockCommentRepo = {
        findOne: jest.fn(),
        save: jest.fn().mockImplementation((c: any) => Promise.resolve(c)),
        softDelete: jest.fn(),
      };

      tasksService = new TasksService();
      (tasksService as any).tasksRepo = mockTasksRepo;
      (tasksService as any).commentRepo = mockCommentRepo;
    });

    it('should reject a user trying to edit someone elses comment', async () => {
      const comment = new Comment({
        commentId: 10,
        content: 'Original content',
        user: new User({ userId: 99 }),
        task: new Task({ taskId: 1 }),
      });

      mockCommentRepo.findOne.mockResolvedValue(comment);

      await expect(
        tasksService.updateComment(1, 10, 42, 'Hacked content')
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject an admin trying to edit someone elses comment', async () => {
      const comment = new Comment({
        commentId: 10,
        content: 'Original content',
        user: new User({ userId: 99 }),
        task: new Task({ taskId: 1 }),
      });

      mockCommentRepo.findOne.mockResolvedValue(comment);

      // Admins can delete any comment, but edit ONLY their own comments
      await expect(
        tasksService.updateComment(1, 10, 1, 'Admin edit')
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow an admin to delete any comment', async () => {
      const comment = new Comment({
        commentId: 10,
        content: 'Original content',
        user: new User({ userId: 99 }),
        task: new Task({ taskId: 1 }),
      });

      mockCommentRepo.findOne.mockResolvedValue(comment);

      await expect(
        tasksService.removeComment(1, 10, 1, true)
      ).resolves.toBeUndefined();
      expect(mockCommentRepo.softDelete).toHaveBeenCalledWith(10);
    });

    it('should reject when comment does not belong to specified taskId', async () => {
      const comment = new Comment({
        commentId: 10,
        content: 'Original content',
        user: new User({ userId: 42 }),
        task: new Task({ taskId: 999 }),
      });

      mockCommentRepo.findOne.mockResolvedValue(comment);

      await expect(
        tasksService.updateComment(1, 10, 42, 'Content')
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Bug 5: assign/unassign relation persistence & body DTO', () => {
    let tasksService: TasksService;
    let mockTasksRepo: any;
    let mockUsersRepo: any;

    beforeEach(() => {
      mockTasksRepo = {
        findOne: jest.fn(),
        save: jest.fn().mockImplementation((t: any) => Promise.resolve(t)),
      };
      mockUsersRepo = {
        findOneBy: jest.fn(),
      };

      tasksService = new TasksService();
      (tasksService as any).tasksRepo = mockTasksRepo;
      (tasksService as any).usersRepo = mockUsersRepo;
    });

    it('assign() loads entity and persists relation via save()', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.UNASSIGNED,
        assignedTo: null,
      });
      const user = new User({ userId: 5 });

      mockTasksRepo.findOne.mockResolvedValue(task);
      mockUsersRepo.findOneBy.mockResolvedValue(user);

      await tasksService.assign(1, 5);

      expect(mockTasksRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 1,
          status: TaskStatus.PENDING,
          assignedTo: expect.objectContaining({ userId: 5 }),
        })
      );
    });

    it('unassign() loads entity, clears assignee and persists via save()', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.PENDING,
        assignedTo: new User({ userId: 5 }),
      });

      mockTasksRepo.findOne.mockResolvedValue(task);

      await tasksService.unassign(1);

      expect(mockTasksRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 1,
          status: TaskStatus.UNASSIGNED,
          assignedTo: null,
        })
      );
    });
  });

  describe('Bug 6: TaskResponseDto fields', () => {
    it('TaskResponseDto exposes submittedAt and completedAt, and endedAt does not exist', () => {
      const now = new Date();
      const taskEntity = {
        taskId: 1,
        name: 'Test Task',
        description: 'Desc',
        startDate: now,
        endDate: now,
        startedAt: now,
        submittedAt: now,
        completedAt: now,
        status: TaskStatus.COMPLETED,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        assignedTo: { userId: 5 },
      };

      const dto = plainToInstance(TaskResponseDto, taskEntity, {
        excludeExtraneousValues: true,
      });

      expect((dto as any).endedAt).toBeUndefined();
      expect(dto.submittedAt).toBeDefined();
      expect(dto.completedAt).toBeDefined();
    });
  });

  describe('Bug 8: AuthGuard and AdminGuard status codes', () => {
    it('AuthGuard throws UnauthorizedException (401) when session.userId is missing', () => {
      const guard = new AuthGuard();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ session: {} }),
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('AdminGuard throws UnauthorizedException (401) when session has no userId', () => {
      const guard = new AdminGuard();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ session: {} }),
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    });

    it('AdminGuard throws ForbiddenException (403) when user is not an admin', () => {
      const guard = new AdminGuard();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ session: { userId: 1, role: UserRole.EMPLOYEE } }),
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('AdminGuard returns true when user is an admin', () => {
      const guard = new AdminGuard();
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ session: { userId: 1, role: UserRole.ADMIN } }),
        }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  describe('Bug 9: Centralized task state machine', () => {
    it('allows valid transitions', () => {
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
    });
  });

  describe('Bug 10: Dead code and inconsistencies', () => {
    let usersService: UsersService;
    let mockUsersRepo: any;
    let mockInvitedRepo: any;
    let mockEntityManager: any;
    let mockConfigService: any;

    beforeEach(() => {
      mockUsersRepo = {
        find: jest.fn(),
        findOneBy: jest.fn(),
      };
      mockInvitedRepo = {};
      mockEntityManager = {
        save: jest.fn(),
      };
      mockConfigService = {
        get: jest.fn(),
      };

      usersService = new UsersService(
        mockInvitedRepo,
        mockUsersRepo,
        mockEntityManager,
        mockConfigService,
      );
    });

    it('findAll returns empty array without throwing NotFoundException when no users exist', async () => {
      mockUsersRepo.find.mockResolvedValue([]);
      const result = await usersService.findAll();
      expect(result).toEqual([]);
    });

    it('findOne does not leak password hash', async () => {
      mockUsersRepo.findOneBy.mockResolvedValue(
        new User({ userId: 1, email: 'test@example.com', password: 'secret_hash' })
      );
      const user = await usersService.findOne({ userId: 1 });
      expect(user?.password).toBeUndefined();
    });

    it('findByEmailWithPassword explicitly returns the password hash for auth', async () => {
      mockUsersRepo.findOneBy.mockResolvedValue(
        new User({ userId: 1, email: 'test@example.com', password: 'secret_hash' })
      );
      const user = await usersService.findByEmailWithPassword('test@example.com');
      expect(user?.password).toBe('secret_hash');
    });
  });
});
