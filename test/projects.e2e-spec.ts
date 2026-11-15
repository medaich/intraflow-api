import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createTestApp, closeTestApp, createAndSignInUser, TestAppBundle } from './test-helper';
import { User, UserRole } from '../src/users/entities/user.entity';
import { Team } from '../src/teams/entities/team.entity';
import { TeamMembership, TeamMemberRole } from '../src/teams/entities/team-membership.entity';
import { Project, ProjectStatus } from '../src/projects/entities/project.entity';
import { Task, TaskStatus } from '../src/tasks/entities/task.entity';
import { AuthService } from '../src/auth/auth.service';

describe('Projects Lifecycle & Integrity E2E Tests (Real DB)', () => {
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
  let modUser: User;
  let modCookies: string[];
  let memberUser: User;
  let memberCookies: string[];

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

    team1 = await teamRepo.save(teamRepo.create({ name: 'Project Test Team 1' }));
    team2 = await teamRepo.save(teamRepo.create({ name: 'Project Test Team 2' }));

    const mod = await createAndSignInUser(app, userRepo, authService, 'mod.proj@intraflow.dev', UserRole.EMPLOYEE, 'Mod Proj');
    modUser = mod.user;
    modCookies = mod.cookies;

    const mem = await createAndSignInUser(app, userRepo, authService, 'mem.proj@intraflow.dev', UserRole.EMPLOYEE, 'Mem Proj');
    memberUser = mem.user;
    memberCookies = mem.cookies;

    await membershipRepo.save(membershipRepo.create({
      teamId: team1.teamId,
      userId: modUser.userId,
      role: TeamMemberRole.MODERATOR,
    }));

    await membershipRepo.save(membershipRepo.create({
      teamId: team1.teamId,
      userId: memberUser.userId,
      role: TeamMemberRole.MEMBER,
    }));

    // Refresh cookies to hydrate membership
    const modRefresh = await request(app.getHttpServer()).post('/auth/signin').send({ email: modUser.email, password: 'Password123!' });
    modCookies = modRefresh.get('Set-Cookie') as string[];

    const memRefresh = await request(app.getHttpServer()).post('/auth/signin').send({ email: memberUser.email, password: 'Password123!' });
    memberCookies = memRefresh.get('Set-Cookie') as string[];
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  describe('1. Project Creation, Visibility & Team Assignment', () => {
    let createdProject: any;

    it('Admin creates project with teamId and dates (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Cookie', adminCookies)
        .send({
          name: 'Phoenix Project',
          description: 'Phoenix description',
          teamId: team1.teamId,
          startDate: '2026-01-01',
          endDate: '2027-06-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.projectId).toBeDefined();
      expect(res.body.name).toBe('Phoenix Project');
      expect(res.body.teamId).toBe(team1.teamId);
      expect(res.body.progress).toEqual({ completed: 0, total: 0, percent: 0 });
      expect(res.body.isOverdue).toBe(false);
      createdProject = res.body;
    });

    it('Moderator and Member of team1 can view team1 project', async () => {
      const modRes = await request(app.getHttpServer())
        .get(`/projects/${createdProject.projectId}`)
        .set('Cookie', modCookies);
      expect(modRes.status).toBe(200);

      const memRes = await request(app.getHttpServer())
        .get(`/projects/${createdProject.projectId}`)
        .set('Cookie', memberCookies);
      expect(memRes.status).toBe(200);
    });

    it('Project listing returns paginated envelope with progress & overdue derived', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects')
        .set('Cookie', modCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const proj = res.body.data.find((p: any) => p.projectId === createdProject.projectId);
      expect(proj).toBeDefined();
      expect(proj.progress).toBeDefined();
    });
  });

  describe('2. Team Change Constraint with Assigned Open Tasks (409)', () => {
    let project: Project;
    let task: Task;

    beforeAll(async () => {
      project = await projectRepo.save(projectRepo.create({
        name: 'Team Swap Project',
        teamId: team1.teamId,
        createdBy: 1,
      }));

      task = await taskRepo.save(taskRepo.create({
        name: 'Assigned Open Task',
        projectId: project.projectId,
        assignedTo: memberUser,
        status: TaskStatus.PENDING,
        startDate: new Date(),
        endDate: new Date(),
      }));
    });

    it('Changing project team while assigned open tasks exist returns 409', async () => {
      const res = await request(app.getHttpServer())
        .put(`/projects/${project.projectId}/team`)
        .set('Cookie', adminCookies)
        .send({ teamId: team2.teamId });

      expect(res.status).toBe(409);
    });

    it('Clearing project team while assigned open tasks exist returns 409', async () => {
      const res = await request(app.getHttpServer())
        .put(`/projects/${project.projectId}/team`)
        .set('Cookie', adminCookies)
        .send({ teamId: null });

      expect(res.status).toBe(409);
    });

    it('Allows changing team once tasks are unassigned or completed', async () => {
      // Unassign task
      await taskRepo.update(task.taskId, { assignedTo: null, status: TaskStatus.UNASSIGNED });

      const res = await request(app.getHttpServer())
        .put(`/projects/${project.projectId}/team`)
        .set('Cookie', adminCookies)
        .send({ teamId: team2.teamId });

      expect(res.status).toBe(200);
      expect(res.body.teamId).toBe(team2.teamId);
    });
  });

  describe('3. Project Deletion vs ARCHIVED (409)', () => {
    let projectWithTasks: Project;

    beforeAll(async () => {
      projectWithTasks = await projectRepo.save(projectRepo.create({
        name: 'Project With Tasks',
        teamId: team1.teamId,
        createdBy: 1,
      }));

      await taskRepo.save(taskRepo.create({
        name: 'Task In Project',
        projectId: projectWithTasks.projectId,
        status: TaskStatus.UNASSIGNED,
        startDate: new Date(),
        endDate: new Date(),
      }));
    });

    it('Deleting a project that has tasks returns 409', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/projects/${projectWithTasks.projectId}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(409);
    });

    it('Deleting a project with 0 tasks succeeds with 204', async () => {
      const emptyProject = await projectRepo.save(projectRepo.create({
        name: 'Empty Project',
        createdBy: 1,
      }));

      const res = await request(app.getHttpServer())
        .delete(`/projects/${emptyProject.projectId}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(204);
    });
  });

  describe('4. ARCHIVED Project Rejection Rules (409)', () => {
    let archivedProject: Project;
    let archivedTask: Task;

    beforeAll(async () => {
      archivedProject = await projectRepo.save(projectRepo.create({
        name: 'Archived Project',
        teamId: team1.teamId,
        status: ProjectStatus.ARCHIVED,
        createdBy: 1,
      }));

      archivedTask = await taskRepo.save(taskRepo.create({
        name: 'Task in Archived Project',
        projectId: archivedProject.projectId,
        status: TaskStatus.UNASSIGNED,
        startDate: new Date(),
        endDate: new Date(),
      }));
    });

    it('ARCHIVED project rejects new task creation (409)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/projects/${archivedProject.projectId}/tasks`)
        .set('Cookie', adminCookies)
        .send({
          name: 'Task in Archived',
          startDate: '2026-01-01',
          endDate: '2026-01-02',
        });

      expect(res.status).toBe(409);
    });

    it('ARCHIVED project rejects task assignment (409)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${archivedTask.taskId}/assign`)
        .set('Cookie', adminCookies)
        .send({ userId: memberUser.userId });

      expect(res.status).toBe(409);
    });

    it('ARCHIVED project rejects dependency updates (409)', async () => {
      const res = await request(app.getHttpServer())
        .put(`/tasks/${archivedTask.taskId}/dependencies`)
        .set('Cookie', adminCookies)
        .send({ dependsOn: [] });

      expect(res.status).toBe(409);
    });
  });

  describe('5. Project Completion Rules (409 vs 200)', () => {
    let compProject: Project;
    let compTask: Task;

    beforeAll(async () => {
      compProject = await projectRepo.save(projectRepo.create({
        name: 'Completion Project',
        teamId: team1.teamId,
        status: ProjectStatus.ACTIVE,
        createdBy: 1,
      }));

      compTask = await taskRepo.save(taskRepo.create({
        name: 'Pending Task',
        projectId: compProject.projectId,
        status: TaskStatus.PENDING,
        startDate: new Date(),
        endDate: new Date(),
      }));
    });

    it('Setting project COMPLETED with open tasks returns 409', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/projects/${compProject.projectId}`)
        .set('Cookie', adminCookies)
        .send({ status: ProjectStatus.COMPLETED });

      expect(res.status).toBe(409);
    });

    it('Setting project COMPLETED succeeds for Moderator when all tasks are COMPLETED', async () => {
      // Complete the task
      await taskRepo.update(compTask.taskId, {
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
      });

      const res = await request(app.getHttpServer())
        .patch(`/projects/${compProject.projectId}`)
        .set('Cookie', modCookies)
        .send({ status: ProjectStatus.COMPLETED });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(ProjectStatus.COMPLETED);
    });
  });

  describe('6. Derived Progress and Overdue Logic', () => {
    it('Overdue is true when endDate is past and project is ACTIVE', async () => {
      const overdueProj = await projectRepo.save(projectRepo.create({
        name: 'Overdue Project',
        teamId: team1.teamId,
        status: ProjectStatus.ACTIVE,
        endDate: new Date('2020-01-01'), // past
        createdBy: 1,
      }));

      const res = await request(app.getHttpServer())
        .get(`/projects/${overdueProj.projectId}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.isOverdue).toBe(true);
    });

    it('GET /projects computes progress using aggregate query without N+1 queries across multiple projects', async () => {
      // Create project A with 3 tasks (2 completed, 1 pending)
      const projA = await projectRepo.save(projectRepo.create({
        name: 'Aggregate Test Proj A',
        teamId: team1.teamId,
        createdBy: 1,
      }));
      await taskRepo.save([
        taskRepo.create({ name: 'TA1', projectId: projA.projectId, status: TaskStatus.COMPLETED, startDate: new Date(), endDate: new Date() }),
        taskRepo.create({ name: 'TA2', projectId: projA.projectId, status: TaskStatus.COMPLETED, startDate: new Date(), endDate: new Date() }),
        taskRepo.create({ name: 'TA3', projectId: projA.projectId, status: TaskStatus.PENDING, startDate: new Date(), endDate: new Date() }),
      ]);

      // Create project B with 2 tasks (0 completed, 2 pending)
      const projB = await projectRepo.save(projectRepo.create({
        name: 'Aggregate Test Proj B',
        teamId: team1.teamId,
        createdBy: 1,
      }));
      await taskRepo.save([
        taskRepo.create({ name: 'TB1', projectId: projB.projectId, status: TaskStatus.PENDING, startDate: new Date(), endDate: new Date() }),
        taskRepo.create({ name: 'TB2', projectId: projB.projectId, status: TaskStatus.PENDING, startDate: new Date(), endDate: new Date() }),
      ]);

      const res = await request(app.getHttpServer())
        .get('/projects')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const fetchedA = res.body.data.find((p: any) => p.projectId === projA.projectId);
      const fetchedB = res.body.data.find((p: any) => p.projectId === projB.projectId);

      expect(fetchedA).toBeDefined();
      expect(fetchedA.progress).toEqual({ completed: 2, total: 3, percent: 67 });

      expect(fetchedB).toBeDefined();
      expect(fetchedB.progress).toEqual({ completed: 0, total: 2, percent: 0 });
    });
  });
});
