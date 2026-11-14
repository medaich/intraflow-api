import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createTestApp, closeTestApp, createAndSignInUser, TestAppBundle } from './test-helper';
import { User, UserRole } from '../src/users/entities/user.entity';
import { Team } from '../src/teams/entities/team.entity';
import { TeamMembership, TeamMemberRole } from '../src/teams/entities/team-membership.entity';
import { Project } from '../src/projects/entities/project.entity';
import { Task, TaskStatus } from '../src/tasks/entities/task.entity';
import { Comment } from '../src/tasks/entities/comment.entity';
import { UsersService } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';

describe('Password Hygiene & Hydration E2E Tests (Real DB)', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let membershipRepo: Repository<TeamMembership>;
  let projectRepo: Repository<Project>;
  let taskRepo: Repository<Task>;
  let commentRepo: Repository<Comment>;
  let usersService: UsersService;
  let authService: AuthService;

  let adminCookies: string[];
  let team: Team;
  let project: Project;
  let task: Task;
  let memberUser: User;
  let memberCookies: string[];

  function assertNoPasswordInObject(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return;
    expect(obj).not.toHaveProperty('password');
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (typeof record[key] === 'object' && record[key] !== null) {
        assertNoPasswordInObject(record[key]);
      }
    }
  }

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = bundle.moduleFixture.get(getRepositoryToken(User));
    teamRepo = bundle.moduleFixture.get(getRepositoryToken(Team));
    membershipRepo = bundle.moduleFixture.get(getRepositoryToken(TeamMembership));
    projectRepo = bundle.moduleFixture.get(getRepositoryToken(Project));
    taskRepo = bundle.moduleFixture.get(getRepositoryToken(Task));
    commentRepo = bundle.moduleFixture.get(getRepositoryToken(Comment));
    usersService = bundle.moduleFixture.get(UsersService);
    authService = bundle.moduleFixture.get(AuthService);

    const admin = await createAndSignInUser(app, userRepo, authService, 'admin.hygiene@intraflow.dev', UserRole.ADMIN, 'Admin');
    adminCookies = admin.cookies;

    team = await teamRepo.save(teamRepo.create({ name: 'Hygiene Team' }));

    const mem = await createAndSignInUser(app, userRepo, authService, 'member.hygiene@intraflow.dev', UserRole.EMPLOYEE, 'Mem Hygiene');
    memberUser = mem.user;
    await membershipRepo.save(membershipRepo.create({ teamId: team.teamId, userId: memberUser.userId, role: TeamMemberRole.MEMBER }));
    const memRefresh = await request(app.getHttpServer()).post('/auth/signin').send({ email: memberUser.email, password: 'Password123!' });
    memberCookies = memRefresh.get('Set-Cookie') as string[];

    project = await projectRepo.save(projectRepo.create({
      name: 'Hygiene Project',
      teamId: team.teamId,
      createdBy: admin.user.userId,
    }));

    task = await taskRepo.save(taskRepo.create({
      name: 'Hygiene Task',
      projectId: project.projectId,
      assignedTo: memberUser,
      status: TaskStatus.PENDING,
      startDate: new Date(),
      endDate: new Date(),
    }));

    // Add normal comment and system comment
    await commentRepo.save(commentRepo.create({
      content: 'Normal user comment',
      user: memberUser,
      task,
    }));
    await commentRepo.save(commentRepo.create({
      content: '[System] System generated comment',
      user: null,
      task,
    }));
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  describe('1. Password Hash Non-Leakage across All New & Embedded Endpoints', () => {
    it('GET /teams does not leak passwords', async () => {
      const res = await request(app.getHttpServer()).get('/teams').set('Cookie', adminCookies);
      expect(res.status).toBe(200);
      assertNoPasswordInObject(res.body);
    });

    it('GET /teams/my-team does not leak passwords (including roster users)', async () => {
      const res = await request(app.getHttpServer()).get('/teams/my-team').set('Cookie', memberCookies);
      expect(res.status).toBe(200);
      assertNoPasswordInObject(res.body);
      expect(res.body.members).toBeDefined();
    });

    it('GET /projects does not leak passwords', async () => {
      const res = await request(app.getHttpServer()).get('/projects').set('Cookie', adminCookies);
      expect(res.status).toBe(200);
      assertNoPasswordInObject(res.body);
    });

    it('GET /projects/:projectId does not leak passwords', async () => {
      const res = await request(app.getHttpServer()).get(`/projects/${project.projectId}`).set('Cookie', adminCookies);
      expect(res.status).toBe(200);
      assertNoPasswordInObject(res.body);
    });

    it('GET /tasks/:taskId does not leak passwords (including assignedTo user)', async () => {
      const res = await request(app.getHttpServer()).get(`/tasks/${task.taskId}`).set('Cookie', adminCookies);
      expect(res.status).toBe(200);
      assertNoPasswordInObject(res.body);
      expect(res.body.assignedTo).toBeDefined();
      expect(res.body.assignedTo.userId).toBe(memberUser.userId);
      expect(res.body.assignedTo.name).toBe('Mem Hygiene');
    });

    it('GET /tasks/:taskId/comments does not leak passwords in comments or system comments', async () => {
      const res = await request(app.getHttpServer()).get(`/tasks/${task.taskId}/comments`).set('Cookie', adminCookies);
      expect(res.status).toBe(200);
      assertNoPasswordInObject(res.body);
    });
  });

  describe('2. Single Hydration Guarantee Updated for Membership', () => {
    it('executes exactly one DB lookup per request and loads team membership relation', async () => {
      const spy = jest.spyOn(usersService, 'findByIdForAuth');

      const res = await request(app.getHttpServer())
        .get('/teams/my-team')
        .set('Cookie', memberCookies);

      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);

      // Verify that findByIdForAuth was called with the member's ID and loaded membership
      const loadedUser = await spy.mock.results[0].value;
      expect(loadedUser).toBeDefined();
      expect(loadedUser.membership).toBeDefined();
      expect(loadedUser.membership.teamId).toBe(team.teamId);
      expect(loadedUser.membership.role).toBe(TeamMemberRole.MEMBER);

      spy.mockRestore();
    });
  });

  describe('3. System Comment Spoofing Protection (isSystem Flag)', () => {
    it('Normal user posting content starting with "[System]" receives isSystem=false', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${task.taskId}/comments`)
        .set('Cookie', memberCookies)
        .send({ content: '[System] Attempting to spoof system alert' });

      expect(res.status).toBe(201);
      expect(res.body.content).toBe('[System] Attempting to spoof system alert');
      expect(res.body.isSystem).toBe(false);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.userId).toBe(memberUser.userId);

      // Verify re-fetched from GET
      const getRes = await request(app.getHttpServer())
        .get(`/tasks/${task.taskId}/comments`)
        .set('Cookie', memberCookies);
      expect(getRes.status).toBe(200);
      const spoofed = getRes.body.find((c: any) => c.commentId === res.body.commentId);
      expect(spoofed.isSystem).toBe(false);
      expect(spoofed.user.userId).toBe(memberUser.userId);
    });
  });
});
