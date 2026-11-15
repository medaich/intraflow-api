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
import { Task, TaskPriority, TaskStatus } from '../src/tasks/entities/task.entity';
import { TaskTimeState } from '../src/tasks/task-time-state';
import { ClockService } from '../src/common/clock/clock.service';

describe('Pagination, Sorting, and Filtering Real-DB E2E Tests', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let membershipRepo: Repository<TeamMembership>;
  let projectRepo: Repository<Project>;
  let taskRepo: Repository<Task>;
  let clockService: ClockService;

  let adminCookies: string[];
  let mod1Cookies: string[];

  let adminUser: User;
  let mod1User: User;
  let mem1User: User;

  let team1: Team;
  let team2: Team;

  let project1: Project;

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = app.get(getRepositoryToken(User));
    teamRepo = app.get(getRepositoryToken(Team));
    membershipRepo = app.get(getRepositoryToken(TeamMembership));
    projectRepo = app.get(getRepositoryToken(Project));
    taskRepo = app.get(getRepositoryToken(Task));
    clockService = app.get(ClockService);

    // Set fixed clock for deterministic timeState tests: 2026-06-15T12:00:00Z
    clockService.setFixedTime('2026-06-15T12:00:00.000Z');

    const admin = await createAndSignInUser(app, userRepo, 'page.admin@intraflow.dev', UserRole.ADMIN);
    adminUser = admin.user;
    adminCookies = admin.cookies;

    team1 = await teamRepo.save(teamRepo.create({ name: 'Alpha Team' }));
    team2 = await teamRepo.save(teamRepo.create({ name: 'Beta Team' }));

    const mod1 = await createAndSignInUser(app, userRepo, 'page.mod1@intraflow.dev', UserRole.EMPLOYEE);
    mod1User = mod1.user;
    mod1Cookies = mod1.cookies;
    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: mod1User.userId, role: TeamMemberRole.MODERATOR }));

    const mem1 = await createAndSignInUser(app, userRepo, 'page.mem1@intraflow.dev', UserRole.EMPLOYEE);
    mem1User = mem1.user;
    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: mem1User.userId, role: TeamMemberRole.MEMBER }));

    // Seed Projects
    project1 = await projectRepo.save(projectRepo.create({
      name: 'Project Alpha',
      teamId: team1.teamId,
      createdBy: adminUser.userId,
      status: ProjectStatus.ACTIVE,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    }));

    await projectRepo.save(projectRepo.create({
      name: 'Project Beta',
      teamId: team2.teamId,
      createdBy: adminUser.userId,
      status: ProjectStatus.ACTIVE,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    }));
  });

  afterAll(async () => {
    clockService.reset();
    await closeTestApp(bundle);
  });

  describe('1. Validation and Query Error Handling', () => {
    it('page < 1 returns 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?page=0')
        .set('Cookie', adminCookies);
      expect(res.status).toBe(400);
    });

    it('limit < 1 or limit > 100 returns 400 Bad Request', async () => {
      const resLow = await request(app.getHttpServer())
        .get('/tasks?limit=0')
        .set('Cookie', adminCookies);
      expect(resLow.status).toBe(400);

      const resHigh = await request(app.getHttpServer())
        .get('/tasks?limit=101')
        .set('Cookie', adminCookies);
      expect(resHigh.status).toBe(400);
    });

    it('invalid sort format or unknown sort field returns 400 Bad Request', async () => {
      const resNoDir = await request(app.getHttpServer())
        .get('/tasks?sort=createdAt')
        .set('Cookie', adminCookies);
      expect(resNoDir.status).toBe(400);

      const resInvalidField = await request(app.getHttpServer())
        .get('/tasks?sort=secretField:asc')
        .set('Cookie', adminCookies);
      expect(resInvalidField.status).toBe(400);

      const resInvalidDir = await request(app.getHttpServer())
        .get('/tasks?sort=name:sideways')
        .set('Cookie', adminCookies);
      expect(resInvalidDir.status).toBe(400);
    });

    it('unknown query parameters return 400 Bad Request (strict whitelist)', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?unsupportedFilter=hack')
        .set('Cookie', adminCookies);
      expect(res.status).toBe(400);
    });
  });

  describe('2. Scope Rules and Envelope Structure', () => {
    it('GET /projects returns envelope { data, meta } and scopes totals for non-admin', async () => {
      // Admin sees both projects
      const adminRes = await request(app.getHttpServer())
        .get('/projects')
        .set('Cookie', adminCookies);

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data).toBeDefined();
      expect(adminRes.body.meta).toBeDefined();
      expect(adminRes.body.meta.total).toBeGreaterThanOrEqual(2);

      // Moderator 1 sees only project1 (team1)
      const modRes = await request(app.getHttpServer())
        .get('/projects')
        .set('Cookie', mod1Cookies);

      expect(modRes.status).toBe(200);
      expect(modRes.body.meta.total).toBe(1);
      expect(modRes.body.data.length).toBe(1);
      expect(modRes.body.data[0].projectId).toBe(project1.projectId);

      // Moderator cannot see outside scope by filtering teamId=team2 -> returns empty total 0
      const outsideRes = await request(app.getHttpServer())
        .get(`/projects?teamId=${team2.teamId}`)
        .set('Cookie', mod1Cookies);

      expect(outsideRes.status).toBe(200);
      expect(outsideRes.body.meta.total).toBe(0);
      expect(outsideRes.body.data).toEqual([]);
    });

    it('Page beyond the last returns empty data with correct meta', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects?page=999&limit=20')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.page).toBe(999);
      expect(res.body.meta.limit).toBe(20);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
      expect(res.body.meta.totalPages).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. Ordering Stability Across Pages (Deterministic Tiebreaker)', () => {
    beforeAll(async () => {
      // Seed 5 tasks with identical names to force tiebreaker reliance
      const tasksToSeed: Partial<Task>[] = [];
      for (let i = 1; i <= 5; i++) {
        tasksToSeed.push({
          name: 'Tiebreaker Task',
          projectId: project1.projectId,
          status: TaskStatus.UNASSIGNED,
          priority: TaskPriority.MEDIUM,
          startDate: new Date('2026-06-01'),
          endDate: new Date('2026-06-30'),
        });
      }
      await taskRepo.save(taskRepo.create(tasksToSeed));
    });

    it('paginating with limit=2 produces stable non-overlapping pages', async () => {
      const p1 = await request(app.getHttpServer())
        .get('/tasks?search=Tiebreaker&sort=name:asc&page=1&limit=2')
        .set('Cookie', adminCookies);

      const p2 = await request(app.getHttpServer())
        .get('/tasks?search=Tiebreaker&sort=name:asc&page=2&limit=2')
        .set('Cookie', adminCookies);

      expect(p1.status).toBe(200);
      expect(p2.status).toBe(200);
      expect(p1.body.data.length).toBe(2);
      expect(p2.body.data.length).toBe(2);

      const p1Ids = p1.body.data.map((t: any) => t.taskId);
      const p2Ids = p2.body.data.map((t: any) => t.taskId);

      // Assert no overlap
      const intersection = p1Ids.filter((id: number) => p2Ids.includes(id));
      expect(intersection).toEqual([]);
    });
  });

  describe('4. Enum-Order Priority Sorting (LOW < MEDIUM < HIGH < URGENT)', () => {
    beforeAll(async () => {
      // Seed 4 tasks with unique priorities
      await taskRepo.save([
        taskRepo.create({ name: 'P-Low', projectId: project1.projectId, priority: TaskPriority.LOW, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }),
        taskRepo.create({ name: 'P-Medium', projectId: project1.projectId, priority: TaskPriority.MEDIUM, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }),
        taskRepo.create({ name: 'P-High', projectId: project1.projectId, priority: TaskPriority.HIGH, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }),
        taskRepo.create({ name: 'P-Urgent', projectId: project1.projectId, priority: TaskPriority.URGENT, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }),
      ]);
    });

    it('sort=priority:asc follows enum order LOW -> MEDIUM -> HIGH -> URGENT (not alphabetical)', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?search=P-&sort=priority:asc&limit=10')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const priorities = res.body.data.map((t: any) => t.priority);
      // In alphabetical order HIGH would come first. In enum order LOW comes first!
      expect(priorities).toEqual([
        TaskPriority.LOW,
        TaskPriority.MEDIUM,
        TaskPriority.HIGH,
        TaskPriority.URGENT,
      ]);
    });

    it('sort=priority:desc follows reverse enum order URGENT -> HIGH -> MEDIUM -> LOW', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?search=P-&sort=priority:desc&limit=10')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      const priorities = res.body.data.map((t: any) => t.priority);
      expect(priorities).toEqual([
        TaskPriority.URGENT,
        TaskPriority.HIGH,
        TaskPriority.MEDIUM,
        TaskPriority.LOW,
      ]);
    });
  });

  describe('5. SQL Search Escaping (% and _)', () => {
    beforeAll(async () => {
      await taskRepo.save([
        taskRepo.create({ name: 'Special 100% discount task', projectId: project1.projectId, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }),
        taskRepo.create({ name: 'Special 1000 items task', projectId: project1.projectId, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }),
        taskRepo.create({ name: 'Wildcard_underscore_task', projectId: project1.projectId, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }),
        taskRepo.create({ name: 'WildcardXunderscoreXtask', projectId: project1.projectId, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }),
      ]);
    });

    it('searching for literal "%" does not treat it as SQL wildcard matching everything', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?search=100%')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Special 100% discount task');
    });

    it('searching for literal "_" does not match single arbitrary character', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?search=card_under')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Wildcard_underscore_task');
    });
  });

  describe('6. No Row Duplication from Joins with Dependencies', () => {
    it('tasks with multiple dependencies do not duplicate rows in paginated queries', async () => {
      // Create Task X and 3 dependency tasks D1, D2, D3
      const d1 = await taskRepo.save(taskRepo.create({ name: 'Dep D1', projectId: project1.projectId, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }));
      const d2 = await taskRepo.save(taskRepo.create({ name: 'Dep D2', projectId: project1.projectId, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }));
      const d3 = await taskRepo.save(taskRepo.create({ name: 'Dep D3', projectId: project1.projectId, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }));

      const mainTask = await taskRepo.save(taskRepo.create({
        name: 'MultiDep Main Task',
        projectId: project1.projectId,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-30'),
        dependsOn: [d1, d2, d3],
      }));

      const res = await request(app.getHttpServer())
        .get('/tasks?search=MultiDep Main Task')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].taskId).toBe(mainTask.taskId);
      expect(res.body.data[0].dependsOn).toHaveLength(3);
    });
  });

  describe('7. Derived TimeState Filtering in SQL', () => {
    beforeAll(async () => {
      // Clock is fixed at 2026-06-15T12:00:00.000Z
      await taskRepo.save([
        // DONE: status = COMPLETED
        taskRepo.create({ name: 'TimeState-Done', projectId: project1.projectId, status: TaskStatus.COMPLETED, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-10') }),
        // OVERDUE: endDate < now (2026-06-10 < 2026-06-15), not completed
        taskRepo.create({ name: 'TimeState-Overdue', projectId: project1.projectId, status: TaskStatus.IN_PROGRESS, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-10') }),
        // UPCOMING: startDate > now (2026-06-20 > 2026-06-15), not completed
        taskRepo.create({ name: 'TimeState-Upcoming', projectId: project1.projectId, status: TaskStatus.PENDING, startDate: new Date('2026-06-20'), endDate: new Date('2026-06-30') }),
        // ACTIVE: startDate <= now and endDate >= now, not completed
        taskRepo.create({ name: 'TimeState-Active', projectId: project1.projectId, status: TaskStatus.IN_PROGRESS, startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30') }),
      ]);
    });

    it('filters timeState=DONE', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?search=TimeState-&timeState=DONE')
        .set('Cookie', adminCookies);
      expect(res.status).toBe(200);
      expect(res.body.data.every((t: any) => t.timeState === TaskTimeState.DONE)).toBe(true);
      expect(res.body.data.some((t: any) => t.name === 'TimeState-Done')).toBe(true);
    });

    it('filters timeState=OVERDUE', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?search=TimeState-&timeState=OVERDUE')
        .set('Cookie', adminCookies);
      expect(res.status).toBe(200);
      expect(res.body.data.every((t: any) => t.timeState === TaskTimeState.OVERDUE)).toBe(true);
      expect(res.body.data.some((t: any) => t.name === 'TimeState-Overdue')).toBe(true);
    });

    it('filters timeState=UPCOMING', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?search=TimeState-&timeState=UPCOMING')
        .set('Cookie', adminCookies);
      expect(res.status).toBe(200);
      expect(res.body.data.every((t: any) => t.timeState === TaskTimeState.UPCOMING)).toBe(true);
      expect(res.body.data.some((t: any) => t.name === 'TimeState-Upcoming')).toBe(true);
    });

    it('filters timeState=ACTIVE', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks?search=TimeState-&timeState=ACTIVE')
        .set('Cookie', adminCookies);
      expect(res.status).toBe(200);
      expect(res.body.data.every((t: any) => t.timeState === TaskTimeState.ACTIVE)).toBe(true);
      expect(res.body.data.some((t: any) => t.name === 'TimeState-Active')).toBe(true);
    });

    it('boundary tests with fixed clock: exactly start, exactly end, COMPLETED past end', async () => {
      const baseNow = new Date('2026-06-15T12:00:00.000Z');
      await taskRepo.save([
        // Exactly end: endDate === now (ACTIVE, not OVERDUE)
        taskRepo.create({
          name: 'Boundary-ExactEnd',
          projectId: project1.projectId,
          status: TaskStatus.IN_PROGRESS,
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          endDate: baseNow,
        }),
        // Exactly start: startDate === now (ACTIVE, not UPCOMING)
        taskRepo.create({
          name: 'Boundary-ExactStart',
          projectId: project1.projectId,
          status: TaskStatus.PENDING,
          startDate: baseNow,
          endDate: new Date('2026-06-30T00:00:00.000Z'),
        }),
        // Completed past end date: COMPLETED with endDate in past (DONE, not OVERDUE)
        taskRepo.create({
          name: 'Boundary-CompletedPastEnd',
          projectId: project1.projectId,
          status: TaskStatus.COMPLETED,
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          endDate: new Date('2026-06-10T00:00:00.000Z'),
        }),
      ]);

      // ExactEnd is ACTIVE
      const activeRes = await request(app.getHttpServer())
        .get('/tasks?search=Boundary-&timeState=ACTIVE')
        .set('Cookie', adminCookies);
      expect(activeRes.body.data.some((t: any) => t.name === 'Boundary-ExactEnd')).toBe(true);
      expect(activeRes.body.data.some((t: any) => t.name === 'Boundary-ExactStart')).toBe(true);

      // ExactEnd is NOT in OVERDUE
      const overdueRes = await request(app.getHttpServer())
        .get('/tasks?search=Boundary-ExactEnd&timeState=OVERDUE')
        .set('Cookie', adminCookies);
      expect(overdueRes.body.data.length).toBe(0);

      // CompletedPastEnd is DONE, NOT in OVERDUE
      const doneRes = await request(app.getHttpServer())
        .get('/tasks?search=Boundary-CompletedPastEnd&timeState=DONE')
        .set('Cookie', adminCookies);
      expect(doneRes.body.data.length).toBe(1);

      const overdueCompletedRes = await request(app.getHttpServer())
        .get('/tasks?search=Boundary-CompletedPastEnd&timeState=OVERDUE')
        .set('Cookie', adminCookies);
      expect(overdueCompletedRes.body.data.length).toBe(0);
    });
  });
});

