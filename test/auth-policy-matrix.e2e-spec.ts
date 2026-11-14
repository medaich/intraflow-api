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
import { AuthService } from '../src/auth/auth.service';

describe('Central Authorization Matrix (Table-Driven Real DB E2E)', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let membershipRepo: Repository<TeamMembership>;
  let projectRepo: Repository<Project>;
  let taskRepo: Repository<Task>;
  let commentRepo: Repository<Comment>;
  let authService: AuthService;

  // Actors
  let adminCookies: string[];
  let noTeamCookies: string[];
  let teamMemberCookies: string[];
  let teamModCookies: string[];
  let otherModCookies: string[];

  let team1: Team;
  let team2: Team;
  let project1: Project;
  let task1: Task;
  let commentByOther: Comment;
  let candidateUser: User;
  let memberUser: User;
  let noTeamUser: User;

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = bundle.moduleFixture.get(getRepositoryToken(User));
    teamRepo = bundle.moduleFixture.get(getRepositoryToken(Team));
    membershipRepo = bundle.moduleFixture.get(getRepositoryToken(TeamMembership));
    projectRepo = bundle.moduleFixture.get(getRepositoryToken(Project));
    taskRepo = bundle.moduleFixture.get(getRepositoryToken(Task));
    commentRepo = bundle.moduleFixture.get(getRepositoryToken(Comment));
    authService = bundle.moduleFixture.get(AuthService);

    // 1. Admin
    const admin = await createAndSignInUser(app, userRepo, authService, 'admin.matrix@intraflow.dev', UserRole.ADMIN, 'Admin');
    adminCookies = admin.cookies;

    // 2. Employee without team
    const noTeam = await createAndSignInUser(app, userRepo, authService, 'noteam.matrix@intraflow.dev', UserRole.EMPLOYEE, 'No Team');
    noTeamUser = noTeam.user;
    noTeamCookies = noTeam.cookies;

    // Create Teams
    team1 = await teamRepo.save(teamRepo.create({ name: 'Matrix Team 1' }));
    team2 = await teamRepo.save(teamRepo.create({ name: 'Matrix Team 2' }));

    // 3. Member of Team 1
    const tMem = await createAndSignInUser(app, userRepo, authService, 'member.matrix@intraflow.dev', UserRole.EMPLOYEE, 'Team Member');
    memberUser = tMem.user;
    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: tMem.user.userId, role: TeamMemberRole.MEMBER }));
    teamMemberCookies = tMem.cookies;

    // 4. Moderator of Team 1
    const tMod = await createAndSignInUser(app, userRepo, authService, 'mod.matrix@intraflow.dev', UserRole.EMPLOYEE, 'Team Mod');
    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: tMod.user.userId, role: TeamMemberRole.MODERATOR }));
    teamModCookies = tMod.cookies;

    // 5. Moderator of Team 2 (Another Team)
    const oMod = await createAndSignInUser(app, userRepo, authService, 'othermod.matrix@intraflow.dev', UserRole.EMPLOYEE, 'Other Mod');
    await membershipRepo.save(membershipRepo.create({ teamId: team2.teamId, userId: oMod.user.userId, role: TeamMemberRole.MODERATOR }));
    otherModCookies = oMod.cookies;

    // Candidate user for roster adds
    const cand = await createAndSignInUser(app, userRepo, authService, 'cand.matrix@intraflow.dev', UserRole.EMPLOYEE, 'Cand');
    candidateUser = cand.user;

    // Project in Team 1
    project1 = await projectRepo.save(projectRepo.create({
      name: 'Matrix Project 1',
      teamId: team1.teamId,
      createdBy: admin.user.userId,
    }));

    // Task in Project 1
    task1 = await taskRepo.save(taskRepo.create({
      name: 'Matrix Task 1',
      projectId: project1.projectId,
      status: TaskStatus.UNASSIGNED,
      startDate: new Date(),
      endDate: new Date(),
    }));

    // Comment on Task 1 by another user
    commentByOther = await commentRepo.save(commentRepo.create({
      content: 'Remark by other user',
      task: task1,
      user: noTeam.user,
    }));
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  beforeEach(async () => {
    if (memberUser && team1) {
      await membershipRepo.update(
        { userId: memberUser.userId, teamId: team1.teamId },
        { role: TeamMemberRole.MEMBER },
      );
    }
    if (task1 && noTeamUser) {
      commentByOther = await commentRepo.save(
        commentRepo.create({
          content: 'Remark by other user',
          task: task1,
          user: noTeamUser,
        }),
      );
    }
  });

  type Actor = 'anon' | 'noTeam' | 'teamMember' | 'teamMod' | 'otherMod' | 'admin';

  interface RouteTestMatrix {
    name: string;
    method: 'get' | 'post' | 'put' | 'patch' | 'delete';
    routeTemplate: string;
    path: () => string;
    body?: (actor: Actor) => Record<string, unknown>;
    expected: Record<Actor, number>;
  }

  const matrix: RouteTestMatrix[] = [
    {
      name: 'POST /teams (Admin CRUD)',
      method: 'post',
      routeTemplate: '/teams',
      path: () => '/teams',
      body: (actor) => ({ name: `New Team by ${actor}` }),
      expected: {
        anon: 401,
        noTeam: 403,
        teamMember: 403,
        teamMod: 403,
        otherMod: 403,
        admin: 201,
      },
    },
    {
      name: 'GET /teams (Admin list all)',
      method: 'get',
      routeTemplate: '/teams',
      path: () => '/teams',
      expected: {
        anon: 401,
        noTeam: 403,
        teamMember: 403,
        teamMod: 403,
        otherMod: 403,
        admin: 200,
      },
    },
    {
      name: 'GET /teams/my-team',
      method: 'get',
      routeTemplate: '/teams/my-team',
      path: () => '/teams/my-team',
      expected: {
        anon: 401,
        noTeam: 404,
        teamMember: 200,
        teamMod: 200,
        otherMod: 200,
        admin: 404, // Admin has no team membership
      },
    },
    {
      name: 'GET /teams/:teamId (Team 1)',
      method: 'get',
      routeTemplate: '/teams/:teamId',
      path: () => `/teams/${team1.teamId}`,
      expected: {
        anon: 401,
        noTeam: 404, // not allowed to know it exists
        teamMember: 200,
        teamMod: 200,
        otherMod: 404, // other team -> 404
        admin: 200,
      },
    },
    {
      name: 'POST /teams/:teamId/members (role: MODERATOR)',
      method: 'post',
      routeTemplate: '/teams/:teamId/members',
      path: () => `/teams/${team1.teamId}/members`,
      body: () => ({ userId: candidateUser.userId, role: TeamMemberRole.MODERATOR }),
      expected: {
        anon: 401,
        noTeam: 404,
        teamMember: 403,
        teamMod: 403, // Mod cannot add moderators
        otherMod: 404,
        admin: 201,
      },
    },
    {
      name: 'PATCH /teams/:teamId/members/:userId',
      method: 'patch',
      routeTemplate: '/teams/:teamId/members/:userId',
      path: () => `/teams/${team1.teamId}/members/${memberUser.userId}`,
      body: () => ({ role: TeamMemberRole.MODERATOR }),
      expected: {
        anon: 401,
        noTeam: 404,
        teamMember: 403,
        teamMod: 403, // Mod cannot change roles
        otherMod: 404,
        admin: 200,
      },
    },
    {
      name: 'GET /projects/:projectId (Team 1 Project)',
      method: 'get',
      routeTemplate: '/projects/:projectId',
      path: () => `/projects/${project1.projectId}`,
      expected: {
        anon: 401,
        noTeam: 404,
        teamMember: 200,
        teamMod: 200,
        otherMod: 404,
        admin: 200,
      },
    },
    {
      name: 'PUT /projects/:projectId/team (Admin only)',
      method: 'put',
      routeTemplate: '/projects/:projectId/team',
      path: () => `/projects/${project1.projectId}/team`,
      body: () => ({ teamId: team1.teamId }),
      expected: {
        anon: 401,
        noTeam: 403,
        teamMember: 403,
        teamMod: 403,
        otherMod: 403,
        admin: 200,
      },
    },
    {
      name: 'POST /projects/:projectId/tasks (Create Task in Project)',
      method: 'post',
      routeTemplate: '/projects/:projectId/tasks',
      path: () => `/projects/${project1.projectId}/tasks`,
      body: (actor) => ({
        name: `Task by ${actor}`,
        startDate: '2026-03-01',
        endDate: '2026-03-05',
      }),
      expected: {
        anon: 401,
        noTeam: 404,
        teamMember: 403, // read-only on project tasks
        teamMod: 201, // Moderator of team 1 allowed
        otherMod: 404,
        admin: 201,
      },
    },
    {
      name: 'GET /projects/:projectId/tasks',
      method: 'get',
      routeTemplate: '/projects/:projectId/tasks',
      path: () => `/projects/${project1.projectId}/tasks`,
      expected: {
        anon: 401,
        noTeam: 404,
        teamMember: 200, // Member can view project tasks
        teamMod: 200, // Moderator can view project tasks
        otherMod: 404,
        admin: 200,
      },
    },
    {
      name: 'GET /tasks/:taskId (Task in Team 1 Project)',
      method: 'get',
      routeTemplate: '/tasks/:taskId',
      path: () => `/tasks/${task1.taskId}`,
      expected: {
        anon: 401,
        noTeam: 404,
        teamMember: 200,
        teamMod: 200,
        otherMod: 404,
        admin: 200,
      },
    },
    {
      name: 'DELETE /tasks/:taskId/comments/:commentId (Moderate another user comment)',
      method: 'delete',
      routeTemplate: '/tasks/:taskId/comments/:commentId',
      path: () => `/tasks/${task1.taskId}/comments/${commentByOther.commentId}`,
      expected: {
        anon: 401,
        noTeam: 404, // outsider cannot see task -> 404
        teamMember: 403, // member cannot delete others' comments
        teamMod: 204, // Moderator of task project CAN delete any comment
        otherMod: 404, // other team cannot see task
        admin: 204, // admin can delete any comment
      },
    },
  ];

  const allowlist = new Set<string>([
    // Public unauthenticated routes
    'GET /health',
    'POST /auth/signup',
    'POST /auth/signin',
    'POST /auth/signout',

    // User management & profile (verified in real-db-auth-tasks.e2e-spec.ts and password-hygiene-and-hydration.e2e-spec.ts)
    'POST /users/invite',
    'GET /users',
    'GET /users/me',
    'PATCH /users/me',
    'GET /users/:userId',
    'DELETE /users/:userId',

    // Team management lifecycle (isolated in teams.e2e-spec.ts & team-removal-atomicity.e2e-spec.ts)
    'PATCH /teams/:teamId',
    'DELETE /teams/:teamId',
    'DELETE /teams/:teamId/members/:userId',

    // Project management lifecycle (isolated in projects.e2e-spec.ts)
    'POST /projects',
    'GET /projects',
    'PATCH /projects/:projectId',
    'DELETE /projects/:projectId',

    // Task lifecycle and standalone task management (isolated in tasks-projects-dependencies.e2e-spec.ts & real-db-auth-tasks.e2e-spec.ts)
    'POST /tasks',
    'GET /tasks',
    'PATCH /tasks/:taskId',
    'PUT /tasks/:taskId/dependencies',
    'DELETE /tasks/:taskId',
    'POST /tasks/:taskId/comments',
    'GET /tasks/:taskId/comments',
    'PUT /tasks/:taskId/comments/:commentId',

    // Phase 1 / Phase 2 task execution & legacy lifecycle routes (verified in real-db-auth-tasks.e2e-spec.ts)
    'GET /tasks/my-tasks',
    'GET /tasks/my-tasks/:taskId',
    'POST /tasks/my-tasks/:taskId/start',
    'PATCH /tasks/:taskId/start',
    'POST /tasks/my-tasks/:taskId/submit',
    'PATCH /tasks/:taskId/submit',
    'POST /tasks/:taskId/assign',
    'PATCH /tasks/:taskId/assign',
    'POST /tasks/:taskId/unassign',
    'PATCH /tasks/:taskId/unassign',
    'POST /tasks/:taskId/validate',
    'PATCH /tasks/:taskId/validate',
    'GET /tasks/my-tasks/:taskId/comments',
    'POST /tasks/my-tasks/:taskId/comments',
    'PUT /tasks/my-tasks/:taskId/comments/:commentId',
    'DELETE /tasks/my-tasks/:taskId/comments/:commentId',
  ]);

  function extractRegisteredRoutes(nestApp: INestApplication): { method: string; path: string }[] {
    const expressApp = nestApp.getHttpAdapter().getInstance();
    const router = expressApp.router || expressApp._router;
    const routes: { method: string; path: string }[] = [];
    if (!router || !router.stack) {
      return routes;
    }

    for (const layer of router.stack) {
      if (layer.route) {
        const routePath = layer.route.path;
        if (routePath.includes('splat')) continue;
        const methods = layer.route.methods as Record<string, boolean>;
        for (const [method, active] of Object.entries(methods)) {
          if (active) {
            routes.push({ method: method.toUpperCase(), path: routePath });
          }
        }
      }
    }
    return routes;
  }

  describe('0. Central Authorization Matrix Completeness Meta-Test', () => {
    it('asserts every non-allowlisted registered route in NestJS router is tested in matrix', () => {
      const registeredRoutes = extractRegisteredRoutes(app);
      expect(registeredRoutes.length).toBeGreaterThan(0);

      const matrixRoutes = new Set(matrix.map((m) => `${m.method.toUpperCase()} ${m.routeTemplate}`));
      const uncovered: string[] = [];

      for (const r of registeredRoutes) {
        const key = `${r.method} ${r.path}`;
        if (!matrixRoutes.has(key) && !allowlist.has(key)) {
          uncovered.push(key);
        }
      }

      expect(uncovered).toEqual([]);
    });
  });

  function getCookiesForActor(actor: Actor): string[] | undefined {
    switch (actor) {
      case 'anon': return undefined;
      case 'noTeam': return noTeamCookies;
      case 'teamMember': return teamMemberCookies;
      case 'teamMod': return teamModCookies;
      case 'otherMod': return otherModCookies;
      case 'admin': return adminCookies;
    }
  }

  for (const item of matrix) {
    describe(item.name, () => {
      const actors: Actor[] = ['anon', 'noTeam', 'teamMember', 'teamMod', 'otherMod', 'admin'];

      for (const actor of actors) {
        it(`actor [${actor}] expects HTTP ${item.expected[actor]}`, async () => {
          const req = request(app.getHttpServer())[item.method](item.path());
          const cookies = getCookiesForActor(actor);
          if (cookies) {
            req.set('Cookie', cookies);
          }
          if (item.body) {
            req.send(item.body(actor));
          }

          const res = await req;
          expect(res.status).toBe(item.expected[actor]);
        });
      }
    });
  }
});
