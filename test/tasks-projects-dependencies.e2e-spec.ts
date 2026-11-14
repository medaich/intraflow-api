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
import { AuthService } from '../src/auth/auth.service';

describe('Tasks in Projects & Dependencies E2E Tests (Real DB)', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let membershipRepo: Repository<TeamMembership>;
  let projectRepo: Repository<Project>;
  let taskRepo: Repository<Task>;
  let authService: AuthService;

  let adminCookies: string[];
  let team1: Team;
  let team2: Team;
  let mod1User: User;
  let mod1Cookies: string[];
  let mem1User: User;
  let mem1Cookies: string[];
  let mem2User: User;
  let project1: Project;
  let project2: Project;

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = bundle.moduleFixture.get(getRepositoryToken(User));
    teamRepo = bundle.moduleFixture.get(getRepositoryToken(Team));
    membershipRepo = bundle.moduleFixture.get(getRepositoryToken(TeamMembership));
    projectRepo = bundle.moduleFixture.get(getRepositoryToken(Project));
    taskRepo = bundle.moduleFixture.get(getRepositoryToken(Task));
    authService = bundle.moduleFixture.get(AuthService);

    const admin = await createAndSignInUser(app, userRepo, authService, 'admin@intraflow.dev', UserRole.ADMIN, 'Admin');
    adminCookies = admin.cookies;

    team1 = await teamRepo.save(teamRepo.create({ name: 'Task Team 1' }));
    team2 = await teamRepo.save(teamRepo.create({ name: 'Task Team 2' }));

    const mod1 = await createAndSignInUser(app, userRepo, authService, 'mod1.task@intraflow.dev', UserRole.EMPLOYEE, 'Mod1');
    mod1User = mod1.user;
    mod1Cookies = mod1.cookies;

    const mem1 = await createAndSignInUser(app, userRepo, authService, 'mem1.task@intraflow.dev', UserRole.EMPLOYEE, 'Mem1');
    mem1User = mem1.user;
    mem1Cookies = mem1.cookies;

    const mem2 = await createAndSignInUser(app, userRepo, authService, 'mem2.task@intraflow.dev', UserRole.EMPLOYEE, 'Mem2');
    mem2User = mem2.user;

    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: mod1User.userId, role: TeamMemberRole.MODERATOR }));
    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: mem1User.userId, role: TeamMemberRole.MEMBER }));
    await membershipRepo.save(membershipRepo.create({ teamId: team2.teamId, userId: mem2User.userId, role: TeamMemberRole.MEMBER }));

    const modRefresh = await request(app.getHttpServer()).post('/auth/signin').send({ email: mod1User.email, password: 'Password123!' });
    mod1Cookies = modRefresh.get('Set-Cookie') as string[];

    const memRefresh = await request(app.getHttpServer()).post('/auth/signin').send({ email: mem1User.email, password: 'Password123!' });
    mem1Cookies = memRefresh.get('Set-Cookie') as string[];

    project1 = await projectRepo.save(projectRepo.create({ name: 'Tasks Project 1', teamId: team1.teamId, createdBy: 1 }));
    project2 = await projectRepo.save(projectRepo.create({ name: 'Tasks Project 2', teamId: team2.teamId, createdBy: 1 }));
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  describe('1. Tasks in Projects & Visibility Rules', () => {
    let taskInP1: any;
    let standaloneTask: Task;

    beforeAll(async () => {
      standaloneTask = await taskRepo.save(taskRepo.create({
        name: 'Standalone Task Without Project',
        projectId: null,
        status: TaskStatus.UNASSIGNED,
        startDate: new Date(),
        endDate: new Date(),
      }));
    });

    it('Moderator of Team 1 creates a task inside Project 1 (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/projects/${project1.projectId}/tasks`)
        .set('Cookie', mod1Cookies)
        .send({
          name: 'Task Alpha',
          description: 'Created by mod',
          startDate: '2026-02-01',
          endDate: '2026-02-15',
        });

      expect(res.status).toBe(201);
      expect(res.body.taskId).toBeDefined();
      expect(res.body.projectId).toBe(project1.projectId);
      expect(res.body.dependsOn).toEqual([]);
      expect(res.body.isBlocked).toBe(false);
      taskInP1 = res.body;
    });

    it('Standalone tasks remain invisible to moderators (404)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tasks/${standaloneTask.taskId}`)
        .set('Cookie', mod1Cookies);

      expect(res.status).toBe(404);
    });

    it('Assignee must be a member of the project team (400 even for admin)', async () => {
      // Trying to assign mem2 (from Team 2) to taskInP1 (Team 1) -> 400
      const res = await request(app.getHttpServer())
        .post(`/tasks/${taskInP1.taskId}/assign`)
        .set('Cookie', adminCookies)
        .send({ userId: mem2User.userId });

      expect(res.status).toBe(400);
    });

    it('Assigning a valid team member succeeds (200/201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${taskInP1.taskId}/assign`)
        .set('Cookie', mod1Cookies)
        .send({ userId: mem1User.userId });

      expect(res.status).toBe(201);
      expect(res.body.assignedTo?.userId).toBe(mem1User.userId);
      expect(res.body.status).toBe(TaskStatus.PENDING);
    });
  });

  describe('2. Dependency Rules & Blocking Logic', () => {
    let taskA: Task;
    let taskB: Task;
    let taskC: Task;
    let otherProjectTask: Task;

    beforeAll(async () => {
      taskA = await taskRepo.save(taskRepo.create({
        name: 'Task A',
        projectId: project1.projectId,
        status: TaskStatus.UNASSIGNED,
        startDate: new Date(),
        endDate: new Date(),
      }));

      taskB = await taskRepo.save(taskRepo.create({
        name: 'Task B',
        projectId: project1.projectId,
        status: TaskStatus.UNASSIGNED,
        startDate: new Date(),
        endDate: new Date(),
      }));

      taskC = await taskRepo.save(taskRepo.create({
        name: 'Task C',
        projectId: project1.projectId,
        status: TaskStatus.UNASSIGNED,
        startDate: new Date(),
        endDate: new Date(),
      }));

      otherProjectTask = await taskRepo.save(taskRepo.create({
        name: 'Task in Other Project',
        projectId: project2.projectId,
        status: TaskStatus.UNASSIGNED,
        startDate: new Date(),
        endDate: new Date(),
      }));
    });

    it('Cross-project dependency is rejected (400)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/tasks/${taskA.taskId}/dependencies`)
        .set('Cookie', adminCookies)
        .send({ dependsOn: [otherProjectTask.taskId] });

      expect(res.status).toBe(400);
    });

    it('Self-dependency is rejected (400)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/tasks/${taskA.taskId}/dependencies`)
        .set('Cookie', adminCookies)
        .send({ dependsOn: [taskA.taskId] });

      expect(res.status).toBe(400);
    });

    it('Cycle dependency is rejected (A->B->C->A) (409)', async () => {
      // 1. Task B depends on Task A
      const res1 = await request(app.getHttpServer())
        .put(`/tasks/${taskB.taskId}/dependencies`)
        .set('Cookie', mod1Cookies)
        .send({ dependsOn: [taskA.taskId] });
      expect(res1.status).toBe(200);

      // 2. Task C depends on Task B
      const res2 = await request(app.getHttpServer())
        .put(`/tasks/${taskC.taskId}/dependencies`)
        .set('Cookie', mod1Cookies)
        .send({ dependsOn: [taskB.taskId] });
      expect(res2.status).toBe(200);

      // 3. Task A depends on Task C -> introduces cycle A -> B -> C -> A
      const resCycle = await request(app.getHttpServer())
        .put(`/tasks/${taskA.taskId}/dependencies`)
        .set('Cookie', mod1Cookies)
        .send({ dependsOn: [taskC.taskId] });

      expect(resCycle.status).toBe(409);
    });

    it('Start is blocked (409) with blockingTaskIds when dependency is not COMPLETED', async () => {
      // Assign Task B to mem1
      await request(app.getHttpServer())
        .post(`/tasks/${taskB.taskId}/assign`)
        .set('Cookie', adminCookies)
        .send({ userId: mem1User.userId });

      // Task A is still UNASSIGNED / incomplete. Task B depends on Task A.
      const startBlockedRes = await request(app.getHttpServer())
        .post(`/tasks/my-tasks/${taskB.taskId}/start`)
        .set('Cookie', mem1Cookies);

      expect(startBlockedRes.status).toBe(409);
      expect(startBlockedRes.body.blockingTaskIds).toContain(taskA.taskId);

      // Re-fetch Task B: blockedBy contains taskA, isBlocked is true
      const getB = await request(app.getHttpServer())
        .get(`/tasks/${taskB.taskId}`)
        .set('Cookie', adminCookies);

      expect(getB.body.blockedBy).toContain(taskA.taskId);
      expect(getB.body.isBlocked).toBe(true);
    });

    it('Start succeeds once dependency is validated (COMPLETED)', async () => {
      // Complete Task A
      await taskRepo.update(taskA.taskId, {
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
      });

      // Now start Task B
      const startRes = await request(app.getHttpServer())
        .post(`/tasks/my-tasks/${taskB.taskId}/start`)
        .set('Cookie', mem1Cookies);

      expect(startRes.status).toBe(201);
      expect(startRes.body.status).toBe(TaskStatus.IN_PROGRESS);
      expect(startRes.body.isBlocked).toBe(false);
    });

    it('Soft-deleting a task that another task depends on is rejected with 409', async () => {
      // Task B still depends on Task A
      const delRes = await request(app.getHttpServer())
        .delete(`/tasks/${taskA.taskId}`)
        .set('Cookie', adminCookies);

      expect(delRes.status).toBe(409);
    });

    it('Replace-set semantics: clearing dependencies allows soft-deleting the former dependency', async () => {
      // Clear Task B's dependencies
      const clearRes = await request(app.getHttpServer())
        .put(`/tasks/${taskB.taskId}/dependencies`)
        .set('Cookie', adminCookies)
        .send({ dependsOn: [] });

      expect(clearRes.status).toBe(200);
      expect(clearRes.body.dependsOn).toEqual([]);

      // Now deleting Task A succeeds (204)
      const delRes = await request(app.getHttpServer())
        .delete(`/tasks/${taskA.taskId}`)
        .set('Cookie', adminCookies);

      expect(delRes.status).toBe(204);
    });
  });
});
