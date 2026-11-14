import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieSession from 'cookie-session';
import { Express } from 'express';
import { AppModule } from '../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../src/users/entities/user.entity';
import { Invited } from '../src/users/entities/invited.entity';
import { Task, TaskStatus } from '../src/tasks/entities/task.entity';
import { Comment } from '../src/tasks/entities/comment.entity';
import { UsersService } from '../src/users/users.service';

describe('Real Database End-to-End Tests (MySQL intraflow_test)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let invitedRepo: Repository<Invited>;
  let taskRepo: Repository<Task>;
  let commentRepo: Repository<Comment>;
  let usersService: UsersService;
  let adminCookies: string[];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const configService = moduleFixture.get(ConfigService);

    const expressApp = app.getHttpAdapter().getInstance() as Express;
    expressApp.set('trust proxy', 1);

    app.use(
      cookieSession({
        name: 'session',
        keys: [configService.getOrThrow<string>('COOKIE_KEY')],
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
      }),
    );

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    userRepo = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    invitedRepo = moduleFixture.get<Repository<Invited>>(getRepositoryToken(Invited));
    taskRepo = moduleFixture.get<Repository<Task>>(getRepositoryToken(Task));
    commentRepo = moduleFixture.get<Repository<Comment>>(getRepositoryToken(Comment));
    usersService = moduleFixture.get<UsersService>(UsersService);

    // Clean up test data from prior runs
    await commentRepo.createQueryBuilder().delete().execute();
    await taskRepo.createQueryBuilder().delete().execute();
    await invitedRepo.createQueryBuilder().delete().execute();
    await userRepo
      .createQueryBuilder()
      .delete()
      .where('email != :adminEmail', { adminEmail: 'admin@intraflow.dev' })
      .execute();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('1. Initial Admin Bootstrap & Signin', () => {
    it('bootstraps the initial admin in the real database on startup', async () => {
      const admin = await userRepo
        .createQueryBuilder('user')
        .addSelect('user.password')
        .where('user.email = :email', { email: 'admin@intraflow.dev' })
        .getOne();

      expect(admin).toBeDefined();
      expect(admin?.role).toBe(UserRole.ADMIN);
      expect(admin?.password).toContain('v2.');
    });

    it('signs in successfully with admin credentials and receives session cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signin')
        .set('X-Forwarded-For', '10.0.1.1')
        .send({
          email: 'admin@intraflow.dev',
          password: 'AdminPassword123!',
        });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe('admin@intraflow.dev');
      expect(res.body.role).toBe(UserRole.ADMIN);
      expect(res.body.password).toBeUndefined();
      expect(res.headers['set-cookie']).toBeDefined();
      adminCookies = res.headers['set-cookie'] as string[];
    });

    it('returns uniform 401 Invalid credentials for unknown email', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signin')
        .set('X-Forwarded-For', '10.0.1.1')
        .send({
          email: 'nonexistent@intraflow.dev',
          password: 'SomePassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid credentials');
      expect(res.body.password).toBeUndefined();
    });

    it('returns uniform 401 Invalid credentials for bad password on existing user', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signin')
        .set('X-Forwarded-For', '10.0.1.1')
        .send({
          email: 'admin@intraflow.dev',
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid credentials');
    });
  });

  describe('2. Invite Concurrency & Atomic Consumption', () => {
    let sharedInviteToken: string;

    it('admin creates an invitation token', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Cookie', adminCookies)
        .send({
          email: 'concurrent@intraflow.dev',
          role: UserRole.EMPLOYEE,
        });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      sharedInviteToken = res.body.token;
    });

    it('two simultaneous signups with one token -> exactly one succeeds (Item 9)', async () => {
      const signupPayload = {
        name: 'Concurrent User',
        email: 'concurrent@intraflow.dev',
        password: 'SecurePassword123!',
      };

      const results = await Promise.all([
        request(app.getHttpServer())
          .post(`/auth/signup?token=${sharedInviteToken}`)
          .send(signupPayload),
        request(app.getHttpServer())
          .post(`/auth/signup?token=${sharedInviteToken}`)
          .send(signupPayload),
      ]);

      const successCount = results.filter((r) => r.status === 201).length;
      const failureCount = results.filter((r) => r.status >= 400).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Verify token deleted from real DB
      const inviteRecord = await invitedRepo.findOneBy({ token: sharedInviteToken });
      expect(inviteRecord).toBeNull();

      // Verify exactly one user row in database
      const userCount = await userRepo.count({
        where: { email: 'concurrent@intraflow.dev' },
      });
      expect(userCount).toBe(1);
    });
  });

  describe('3. Password Hygiene Across All Endpoints (Item 1)', () => {
    let createdEmployee: User;
    let employeeCookies: string[];
    let createdTaskId: number;

    beforeAll(async () => {
      // Create and sign in an employee user
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Cookie', adminCookies)
        .send({ email: 'hygiene@intraflow.dev', role: UserRole.EMPLOYEE });

      const signupRes = await request(app.getHttpServer())
        .post(`/auth/signup?token=${inviteRes.body.token}`)
        .send({
          name: 'Hygiene Tester',
          email: 'hygiene@intraflow.dev',
          password: 'Password123!',
        });

      expect(signupRes.status).toBe(201);
      expect(signupRes.body.password).toBeUndefined();
      createdEmployee = (await userRepo.findOneBy({ email: 'hygiene@intraflow.dev' }))!;

      const signinRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .set('X-Forwarded-For', '10.0.3.1')
        .send({
          email: 'hygiene@intraflow.dev',
          password: 'Password123!',
        });
      expect(signinRes.status).toBe(201);
      expect(signinRes.body.password).toBeUndefined();
      employeeCookies = signinRes.headers['set-cookie'] as string[];
    });

    it('GET /users never contains password key in any returned user', async () => {
      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const u of res.body) {
        expect(u.password).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(u, 'password')).toBe(false);
      }
    });

    it('GET /users/:userId never contains password key', async () => {
      const res = await request(app.getHttpServer())
        .get(`/users/${createdEmployee.userId}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.password).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(res.body, 'password')).toBe(false);
    });

    it('GET /users/me never contains password key', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', employeeCookies);

      expect(res.status).toBe(200);
      expect(res.body.password).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(res.body, 'password')).toBe(false);
    });

    it('Task response with assignedTo never leaks password', async () => {
      const now = new Date();
      const createRes = await request(app.getHttpServer())
        .post('/tasks')
        .set('Cookie', adminCookies)
        .send({
          name: 'Hygiene Verification Task',
          startDate: now.toISOString(),
          endDate: new Date(now.getTime() + 86400000).toISOString(),
        });

      createdTaskId = createRes.body.taskId;

      const assignRes = await request(app.getHttpServer())
        .post(`/tasks/${createdTaskId}/assign`)
        .set('Cookie', adminCookies)
        .send({ userId: createdEmployee.userId });

      expect(assignRes.status).toBe(201);
      expect(assignRes.body.assignedTo).toBeDefined();
      expect(assignRes.body.assignedTo.password).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(assignRes.body.assignedTo, 'password')).toBe(false);
    });

    it('Comment response with user relation never leaks password', async () => {
      const commentRes = await request(app.getHttpServer())
        .post(`/tasks/my-tasks/${createdTaskId}/comments`)
        .set('Cookie', employeeCookies)
        .send({ content: 'Hygiene audit comment' });

      expect(commentRes.status).toBe(201);
      expect(commentRes.body.user).toBeDefined();
      expect(commentRes.body.user.password).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(commentRes.body.user, 'password')).toBe(false);
    });
  });

  describe('4. Real-DB Task Full Lifecycle & Re-Fetching (Item 2)', () => {
    let lifecycleTaskId: number;
    let employeeId: number;
    let employeeCookies: string[];
    let initialStartedAt: string;

    beforeAll(async () => {
      // Create employee
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Cookie', adminCookies)
        .send({ email: 'lifecycle@intraflow.dev', role: UserRole.EMPLOYEE });

      await request(app.getHttpServer())
        .post(`/auth/signup?token=${inviteRes.body.token}`)
        .send({
          name: 'Lifecycle Worker',
          email: 'lifecycle@intraflow.dev',
          password: 'Password123!',
        });

      const emp = (await userRepo.findOneBy({ email: 'lifecycle@intraflow.dev' }))!;
      employeeId = emp.userId;

      const signinRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .set('X-Forwarded-For', '10.0.4.1')
        .send({ email: 'lifecycle@intraflow.dev', password: 'Password123!' });
      employeeCookies = signinRes.headers['set-cookie'] as string[];
    });

    it('Step 1: Create task -> UNASSIGNED (re-fetched from DB)', async () => {
      const now = new Date();
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Cookie', adminCookies)
        .send({
          name: 'Full Lifecycle Task',
          startDate: now.toISOString(),
          endDate: new Date(now.getTime() + 86400000).toISOString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(TaskStatus.UNASSIGNED);
      lifecycleTaskId = res.body.taskId;

      const fromDb = await taskRepo.findOneBy({ taskId: lifecycleTaskId });
      expect(fromDb?.status).toBe(TaskStatus.UNASSIGNED);
      expect(fromDb?.startedAt).toBeNull();
      expect(fromDb?.submittedAt).toBeNull();
      expect(fromDb?.completedAt).toBeNull();
    });

    it('Step 2: Assign task -> PENDING (re-fetched from DB)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${lifecycleTaskId}/assign`)
        .set('Cookie', adminCookies)
        .send({ userId: employeeId });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(TaskStatus.PENDING);

      const fromDb = await taskRepo.findOne({
        where: { taskId: lifecycleTaskId },
        relations: ['assignedTo'],
      });
      expect(fromDb?.status).toBe(TaskStatus.PENDING);
      expect(fromDb?.assignedTo?.userId).toBe(employeeId);
    });

    it('Step 3: Unassign task -> UNASSIGNED (re-fetched from DB)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${lifecycleTaskId}/unassign`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(TaskStatus.UNASSIGNED);

      const fromDb = await taskRepo.findOne({
        where: { taskId: lifecycleTaskId },
        relations: ['assignedTo'],
      });
      expect(fromDb?.status).toBe(TaskStatus.UNASSIGNED);
      expect(fromDb?.assignedTo).toBeNull();
    });

    it('Step 4: Re-assign task -> PENDING (re-fetched from DB)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${lifecycleTaskId}/assign`)
        .set('Cookie', adminCookies)
        .send({ userId: employeeId });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(TaskStatus.PENDING);

      const fromDb = await taskRepo.findOneBy({ taskId: lifecycleTaskId });
      expect(fromDb?.status).toBe(TaskStatus.PENDING);
    });

    it('Step 5: Start task -> IN_PROGRESS, startedAt set (re-fetched from DB)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/my-tasks/${lifecycleTaskId}/start`)
        .set('Cookie', employeeCookies);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(TaskStatus.IN_PROGRESS);
      expect(res.body.startedAt).toBeDefined();

      const fromDb = await taskRepo.findOneBy({ taskId: lifecycleTaskId });
      expect(fromDb?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(fromDb?.startedAt).not.toBeNull();
      initialStartedAt = fromDb!.startedAt!.toISOString();
    });

    it('Step 6: Submit task -> IN_REVIEW, submittedAt set, startedAt unchanged (re-fetched from DB)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/my-tasks/${lifecycleTaskId}/submit`)
        .set('Cookie', employeeCookies);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(TaskStatus.IN_REVIEW);
      expect(res.body.submittedAt).toBeDefined();
      expect(new Date(String(res.body.startedAt)).getTime()).toEqual(new Date(initialStartedAt).getTime());

      const fromDb = await taskRepo.findOneBy({ taskId: lifecycleTaskId });
      expect(fromDb?.status).toBe(TaskStatus.IN_REVIEW);
      expect(fromDb?.submittedAt).not.toBeNull();
      expect(new Date(fromDb!.startedAt!).getTime()).toEqual(new Date(initialStartedAt).getTime());
    });

    it('Step 7: Validate task -> COMPLETED, completedAt persisted (re-fetched from DB)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${lifecycleTaskId}/validate`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(TaskStatus.COMPLETED);
      expect(res.body.completedAt).toBeDefined();

      const fromDb = await taskRepo.findOneBy({ taskId: lifecycleTaskId });
      expect(fromDb?.status).toBe(TaskStatus.COMPLETED);
      expect(fromDb?.completedAt).not.toBeNull();
    });

    it('Enforces 409 ConflictException over HTTP on illegal transitions', async () => {
      // Re-completing an already COMPLETED task -> 409
      const reValidateRes = await request(app.getHttpServer())
        .post(`/tasks/${lifecycleTaskId}/validate`)
        .set('Cookie', adminCookies);
      expect(reValidateRes.status).toBe(409);

      // Create a fresh task and assign to employee (status: PENDING)
      const now = new Date();
      const freshRes = await request(app.getHttpServer())
        .post('/tasks')
        .set('Cookie', adminCookies)
        .send({
          name: 'Illegal Transition Probe',
          startDate: now.toISOString(),
          endDate: new Date(now.getTime() + 86400000).toISOString(),
        });
      const probeTaskId = freshRes.body.taskId;

      await request(app.getHttpServer())
        .post(`/tasks/${probeTaskId}/assign`)
        .set('Cookie', adminCookies)
        .send({ userId: employeeId });

      // Submitting PENDING task without starting it -> 409
      const submitRes = await request(app.getHttpServer())
        .post(`/tasks/my-tasks/${probeTaskId}/submit`)
        .set('Cookie', employeeCookies);
      expect(submitRes.status).toBe(409);

      // Start task to IN_PROGRESS
      await request(app.getHttpServer())
        .post(`/tasks/my-tasks/${probeTaskId}/start`)
        .set('Cookie', employeeCookies);

      // Starting an already IN_PROGRESS task again -> 409
      const doubleStartRes = await request(app.getHttpServer())
        .post(`/tasks/my-tasks/${probeTaskId}/start`)
        .set('Cookie', employeeCookies);
      expect(doubleStartRes.status).toBe(409);

      // Validating IN_PROGRESS task as admin without submitting it -> 409
      const prematureValidateRes = await request(app.getHttpServer())
        .post(`/tasks/${probeTaskId}/validate`)
        .set('Cookie', adminCookies);
      expect(prematureValidateRes.status).toBe(409);
    });
  });

  describe('5. Stale Sessions & Real-Time DB Hydration (Item 3)', () => {
    it('(a) Soft-deleting an active user holding a valid cookie returns 401 on next request', async () => {
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Cookie', adminCookies)
        .send({ email: 'to-deactivate@intraflow.dev', role: UserRole.EMPLOYEE });

      await request(app.getHttpServer())
        .post(`/auth/signup?token=${inviteRes.body.token}`)
        .send({
          name: 'Soon Deactivated',
          email: 'to-deactivate@intraflow.dev',
          password: 'Password123!',
        });

      const user = (await userRepo.findOneBy({ email: 'to-deactivate@intraflow.dev' }))!;
      const signinRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .set('X-Forwarded-For', '10.0.5.1')
        .send({ email: 'to-deactivate@intraflow.dev', password: 'Password123!' });
      expect(signinRes.status).toBe(201);
      const activeCookies = signinRes.headers['set-cookie'] as string[];

      // Verify cookie currently works
      const meBefore = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', activeCookies);
      expect(meBefore.status).toBe(200);

      // Soft-delete user directly in real DB
      await userRepo.softDelete(user.userId);

      // Next request using existing cookie must immediately return 401
      const meAfter = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', activeCookies);
      expect(meAfter.status).toBe(401);
    });

    it('(b) Demoting a logged-in admin to EMPLOYEE allows /users/me but returns 403 on admin routes', async () => {
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Cookie', adminCookies)
        .send({ email: 'admin-to-demote@intraflow.dev', role: UserRole.ADMIN });

      await request(app.getHttpServer())
        .post(`/auth/signup?token=${inviteRes.body.token}`)
        .send({
          name: 'Admin Demote',
          email: 'admin-to-demote@intraflow.dev',
          password: 'Password123!',
        });

      const targetAdmin = (await userRepo.findOneBy({ email: 'admin-to-demote@intraflow.dev' }))!;
      const signinRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .set('X-Forwarded-For', '10.0.5.2')
        .send({ email: 'admin-to-demote@intraflow.dev', password: 'Password123!' });
      expect(signinRes.status).toBe(201);
      const demotedUserCookies = signinRes.headers['set-cookie'] as string[];

      // Verify admin can access GET /users
      const adminCheckBefore = await request(app.getHttpServer())
        .get('/users')
        .set('Cookie', demotedUserCookies);
      expect(adminCheckBefore.status).toBe(200);

      // Demote to EMPLOYEE directly in the real database
      await userRepo.update(targetAdmin.userId, { role: UserRole.EMPLOYEE });

      // Request to /users/me succeeds and reflects demoted role
      const meRes = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', demotedUserCookies);
      expect(meRes.status).toBe(200);
      expect(meRes.body.role).toBe(UserRole.EMPLOYEE);

      // Request to admin route /users is immediately forbidden (403)
      const adminCheckAfter = await request(app.getHttpServer())
        .get('/users')
        .set('Cookie', demotedUserCookies);
      expect(adminCheckAfter.status).toBe(403);
    });
  });

  describe('6. Single Hydration Verification (Item 6)', () => {
    it('executes exactly one DB lookup per request across AuthGuard, AdminGuard and @CurrentUser', async () => {
      const spy = jest.spyOn(usersService, 'findByIdForAuth');

      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });
  });

  describe('7. Signin Rate Limiting Throttling (Item 11)', () => {
    it('returns 429 on the 6th rapid signin attempt from a given IP without flaking other requests', async () => {
      const testIp = '198.51.100.99';

      // 5 attempts allowed by @Throttle({ default: { limit: 5, ttl: 60000 } })
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/auth/signin')
          .set('X-Forwarded-For', testIp)
          .send({
            email: 'admin@intraflow.dev',
            password: 'BadPassword!',
          });
        expect(res.status).toBe(401);
      }

      // 6th attempt must be throttled with 429
      const throttledRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .set('X-Forwarded-For', testIp)
        .send({
          email: 'admin@intraflow.dev',
          password: 'BadPassword!',
        });
      expect(throttledRes.status).toBe(429);

      // Verify another IP is completely unthrottled (no test suite flakiness)
      const otherIpRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .set('X-Forwarded-For', '198.51.100.100')
        .send({
          email: 'admin@intraflow.dev',
          password: 'BadPassword!',
        });
      expect(otherIpRes.status).toBe(401);
    });
  });

  describe('8. Admin Self-Deletion Protection', () => {
    it('blocks an admin from deleting their own account (400 Bad Request)', async () => {
      const admin = (await userRepo.findOneBy({ email: 'admin@intraflow.dev' }))!;
      const res = await request(app.getHttpServer())
        .delete(`/users/${admin.userId}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('cannot delete their own account');
    });
  });
});
