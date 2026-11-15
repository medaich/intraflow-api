import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TasksService } from './tasks.service';
import { Task, TaskPriority, TaskStatus } from './entities/task.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { Comment } from './entities/comment.entity';
import { Project, ProjectStatus } from '../projects/entities/project.entity';
import { Attachment } from './entities/attachment.entity';
import { AccessPolicyService } from '../auth/policy/access-policy.service';
import { ClockService } from '../common/clock/clock.service';
import { StorageService } from '../storage/storage.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

describe('TasksService (Persistence, Lifecycle, State Machine & Authorization)', () => {
  let tasksService: TasksService;
  let tasksRepo: jest.Mocked<Partial<Repository<Task>>>;
  let usersRepo: jest.Mocked<Partial<Repository<User>>>;
  let commentRepo: jest.Mocked<Partial<Repository<Comment>>>;
  let projectRepo: jest.Mocked<Partial<Repository<Project>>>;
  let attachmentRepo: jest.Mocked<Partial<Repository<Attachment>>>;
  let storageService: jest.Mocked<Partial<StorageService>>;

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
      createQueryBuilder: jest.fn(),
      create: jest.fn((dto) => dto as Task),
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

    attachmentRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto as Attachment),
      save: jest.fn((a) => Promise.resolve({ ...(a as Attachment), attachmentId: 1 })),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
    };

    storageService = {
      put: jest.fn().mockResolvedValue(undefined),
      getStream: jest.fn().mockResolvedValue(Readable.from(['sample data'])),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        AccessPolicyService,
        ClockService,
        { provide: getRepositoryToken(Task), useValue: tasksRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(Comment), useValue: commentRepo },
        { provide: getRepositoryToken(Project), useValue: projectRepo },
        { provide: getRepositoryToken(Attachment), useValue: attachmentRepo },
        { provide: StorageService, useValue: storageService },
        {
          provide: MailService,
          useValue: {
            sendTaskAssigned: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              if (key === 'MAX_FILE_SIZE') return 10485760;
              if (key === 'MAX_ATTACHMENTS_PER_TASK') return 20;
              return defaultValue;
            }),
          },
        },
        {
          provide: getDataSourceToken(),
          useValue: {
            transaction: jest.fn((cb) =>
              cb({
                findOne: jest.fn((entityClass, options) => {
                  if (entityClass === Task) return tasksRepo.findOne!(options);
                  if (entityClass === User) return usersRepo.findOne!(options);
                  if (entityClass === Project) {
                    const res = projectRepo.findOne!(options);
                    if (res) return res;
                    return Promise.resolve(new Project({ projectId: 1, status: ProjectStatus.ACTIVE }));
                  }
                  return tasksRepo.findOne!(options);
                }),
                find: jest.fn((entityClass, options) => {
                  if (entityClass === Task) return tasksRepo.find!(options);
                  return tasksRepo.find!(options);
                }),
                save: jest.fn().mockImplementation((clsOrEntity, entity) => {
                  const toSave = entity || clsOrEntity;
                  return tasksRepo.save!(toSave);
                }),
                create: jest.fn((_cls, dto) => dto),
                remove: jest.fn().mockResolvedValue(undefined),
                delete: jest.fn().mockResolvedValue(undefined),
              }),
            ),
          },
        },
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

  describe('Task Reject Flow', () => {
    it('throws NotFoundException when task does not exist', async () => {
      tasksRepo.findOne!.mockResolvedValue(null);
      await expect(
        tasksService.reject(
          999,
          { reason: 'Missing details' },
          new User({ userId: 1, role: UserRole.ADMIN }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects task in IN_REVIEW back to IN_PROGRESS and saves reason as comment', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.IN_REVIEW,
        submittedAt: new Date(),
        assignedTo: new User({ userId: 10 }),
      });
      tasksRepo.findOne!.mockResolvedValue(task);

      const admin = new User({ userId: 1, role: UserRole.ADMIN });
      const result = await tasksService.reject(1, { reason: 'Please fix edge cases' }, admin);

      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
      expect(result.submittedAt).toBeNull();
    });

    it('throws ConflictException if task is not in IN_REVIEW status', async () => {
      const task = new Task({
        taskId: 1,
        status: TaskStatus.TODO,
      });
      tasksRepo.findOne!.mockResolvedValue(task);

      const admin = new User({ userId: 1, role: UserRole.ADMIN });
      await expect(
        tasksService.reject(1, { reason: 'Invalid state' }, admin),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Task Attachments', () => {
    it('uploadAttachment throws NotFoundException when task not found', async () => {
      tasksRepo.findOne!.mockResolvedValue(null);
      await expect(
        tasksService.uploadAttachment(
          999,
          { originalname: 'file.pdf', size: 100, buffer: Buffer.from('%PDF-1.4') } as Express.Multer.File,
          new User({ userId: 1, role: UserRole.ADMIN }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('uploadAttachment throws PayloadTooLargeException if file exceeds limit', async () => {
      const task = new Task({ taskId: 1, status: TaskStatus.IN_PROGRESS });
      tasksRepo.findOne!.mockResolvedValue(task);

      await expect(
        tasksService.uploadAttachment(
          1,
          { originalname: 'big.pdf', size: 20000000, buffer: Buffer.from('%PDF-1.4') } as Express.Multer.File,
          new User({ userId: 1, role: UserRole.ADMIN }),
        ),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('uploadAttachment succeeds and returns attachment', async () => {
      const task = new Task({ taskId: 1, status: TaskStatus.IN_PROGRESS });
      tasksRepo.findOne!.mockResolvedValue(task);
      attachmentRepo.findOne!.mockResolvedValue(new Attachment({ attachmentId: 1, originalName: 'doc.pdf' }));

      const res = await tasksService.uploadAttachment(
        1,
        { originalname: 'doc.pdf', size: 1000, buffer: Buffer.from('%PDF-1.4 sample content') } as Express.Multer.File,
        new User({ userId: 1, role: UserRole.ADMIN }),
      );

      expect(res.originalName).toBe('doc.pdf');
      expect(storageService.put).toHaveBeenCalled();
    });

    it('getAttachmentForDownload throws NotFoundException if attachment not found', async () => {
      const task = new Task({ taskId: 1, status: TaskStatus.IN_PROGRESS });
      tasksRepo.findOne!.mockResolvedValue(task);
      attachmentRepo.findOne!.mockResolvedValue(null);

      await expect(
        tasksService.getAttachmentForDownload(1, 999, new User({ userId: 1, role: UserRole.ADMIN })),
      ).rejects.toThrow(NotFoundException);
    });

    it('deleteAttachment removes attachment and deletes from storage', async () => {
      const task = new Task({ taskId: 1, status: TaskStatus.IN_PROGRESS });
      tasksRepo.findOne!.mockResolvedValue(task);
      attachmentRepo.findOne!.mockResolvedValue(new Attachment({ attachmentId: 1, storageKey: 'key-1' }));

      const res = await tasksService.deleteAttachment(1, 1, new User({ userId: 1, role: UserRole.ADMIN }));
      expect(res.message).toContain('deleted successfully');
      expect(storageService.delete).toHaveBeenCalledWith('key-1');
    });
  });

  describe('Task Pagination & Creation', () => {
    it('findAll returns paginated envelope', async () => {
      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      tasksRepo.createQueryBuilder!.mockReturnValue(mockQb as never);

      const res = await tasksService.findAll({}, new User({ userId: 1, role: UserRole.ADMIN }));
      expect(res.data).toEqual([]);
      expect(res.meta.total).toBe(0);
    });

    it('create sets default priority and returns enriched task', async () => {
      const task = new Task({
        taskId: 10,
        name: 'New Task',
        priority: TaskPriority.MEDIUM,
        status: TaskStatus.UNASSIGNED,
        dependsOn: [],
      });
      tasksRepo.save!.mockResolvedValue(task);

      const res = await tasksService.create({
        name: 'New Task',
        description: 'Desc',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-10'),
      });
      expect(res.name).toBe('New Task');
    });
  });

  describe('Task Dependencies & Deletion', () => {
    it('setDependencies throws BadRequestException on self-dependency', async () => {
      const task = new Task({ taskId: 1, projectId: 10 });
      tasksRepo.findOne!.mockResolvedValue(task);

      await expect(async () => {
        await tasksService.setDependencies(1, { dependsOn: [1] }, new User({ userId: 1, role: UserRole.ADMIN }));
      }).rejects.toThrow(BadRequestException);
    });

    it('setDependencies throws BadRequestException if task is standalone', async () => {
      const standalone = new Task({ taskId: 1, projectId: null });
      tasksRepo.findOne!.mockResolvedValue(standalone);

      await expect(async () => {
        await tasksService.setDependencies(1, { dependsOn: [2] }, new User({ userId: 1, role: UserRole.ADMIN }));
      }).rejects.toThrow(BadRequestException);
    });

    it('setDependencies throws NotFoundException if dependency not found', async () => {
      const task = new Task({ taskId: 1, projectId: 10 });
      tasksRepo.findOne!.mockResolvedValue(task);
      tasksRepo.find!.mockResolvedValue([]); // not found

      await expect(async () => {
        await tasksService.setDependencies(1, { dependsOn: [2] }, new User({ userId: 1, role: UserRole.ADMIN }));
      }).rejects.toThrow(NotFoundException);
    });

    it('setDependencies sets dependencies successfully', async () => {
      const task = new Task({ taskId: 1, projectId: 10 });
      const depTask = new Task({ taskId: 2, projectId: 10 });
      tasksRepo.findOne!.mockResolvedValue(task);
      tasksRepo.find!
        .mockResolvedValueOnce([depTask]) // dependency lookup
        .mockResolvedValueOnce([task, depTask]); // project tasks for cycle detection
      tasksRepo.save!.mockResolvedValue(new Task({ ...task, dependsOn: [depTask] }));

      const res = await tasksService.setDependencies(
        1,
        { dependsOn: [2] },
        new User({ userId: 1, role: UserRole.ADMIN }),
      );
      expect(res.dependsOn).toHaveLength(1);
    });

    it('remove throws 409 if other active tasks depend on it', async () => {
      const task = new Task({ taskId: 1, projectId: 10 });
      tasksRepo.findOne!.mockResolvedValue(task);
      const mockQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
      };
      tasksRepo.createQueryBuilder!.mockReturnValue(mockQb as never);

      await expect(
        tasksService.remove(1, new User({ userId: 1, role: UserRole.ADMIN })),
      ).rejects.toThrow(ConflictException);
    });

    it('remove soft-deletes task if no active dependents', async () => {
      const task = new Task({ taskId: 1, projectId: 10 });
      tasksRepo.findOne!.mockResolvedValue(task);
      const mockQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };
      tasksRepo.createQueryBuilder!.mockReturnValue(mockQb as never);

      await tasksService.remove(1, new User({ userId: 1, role: UserRole.ADMIN }));
      expect(tasksRepo.softDelete).toHaveBeenCalledWith(1);
    });

    it('comment adds a non-system comment', async () => {
      commentRepo.create = jest.fn((dto) => dto as Comment);
      commentRepo.save = jest.fn((c) => Promise.resolve({ ...c, commentId: 10 } as Comment));
      commentRepo.findOne = jest.fn().mockResolvedValue(
        new Comment({ commentId: 10, content: 'Great work', isSystem: false, task: new Task({ taskId: 1 }) }),
      );

      const res = await tasksService.comment(1, 2, 'Great work', true);
      expect(res.isSystem).toBe(false);
      expect(res.content).toBe('Great work');
    });
  });
});
