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
import { AuthService } from '../src/auth/auth.service';

describe('Teams & Membership E2E Tests (Real DB intraflow_test)', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let membershipRepo: Repository<TeamMembership>;
  let projectRepo: Repository<Project>;
  let authService: AuthService;

  let adminCookies: string[];
  let adminUser: User;
  let employeeCookies: string[];

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = bundle.moduleFixture.get(getRepositoryToken(User));
    teamRepo = bundle.moduleFixture.get(getRepositoryToken(Team));
    membershipRepo = bundle.moduleFixture.get(getRepositoryToken(TeamMembership));
    projectRepo = bundle.moduleFixture.get(getRepositoryToken(Project));
    authService = bundle.moduleFixture.get(AuthService);

    const admin = await createAndSignInUser(app, userRepo, authService, 'admin@intraflow.dev', UserRole.ADMIN, 'Admin');
    adminUser = admin.user;
    adminCookies = admin.cookies;

    const emp = await createAndSignInUser(app, userRepo, authService, 'emp.teams@intraflow.dev', UserRole.EMPLOYEE, 'Emp');
    employeeCookies = emp.cookies;
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  describe('1. Teams CRUD and Access Rules', () => {
    let createdTeamId: number;

    it('Admin creates a team (201)', async () => {
      const res = await request(app.getHttpServer())
        .post('/teams')
        .set('Cookie', adminCookies)
        .send({ name: 'Alpha Squad', description: 'Alpha testing squad' });

      expect(res.status).toBe(201);
      expect(res.body.teamId).toBeDefined();
      expect(res.body.name).toBe('Alpha Squad');
      createdTeamId = res.body.teamId;
    });

    it('Duplicate team name returns 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/teams')
        .set('Cookie', adminCookies)
        .send({ name: 'Alpha Squad' });

      expect(res.status).toBe(409);
    });

    it('Non-admin cannot create a team (403)', async () => {
      const res = await request(app.getHttpServer())
        .post('/teams')
        .set('Cookie', employeeCookies)
        .send({ name: 'Rogue Squad' });

      expect(res.status).toBe(403);
    });

    it('Admin lists all teams (plain array)', async () => {
      const res = await request(app.getHttpServer())
        .get('/teams')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((t: any) => t.teamId === createdTeamId)).toBe(true);
    });

    it('Caller with no team calling GET /teams/my-team returns 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/teams/my-team')
        .set('Cookie', employeeCookies);

      expect(res.status).toBe(404);
    });
  });

  describe('2. Roster Management & Moderator Permissions', () => {
    let team: Team;
    let modUser: User;
    let modCookies: string[];
    let memberUser: User;
    let candidateUser: User;

    beforeAll(async () => {
      team = await teamRepo.save(teamRepo.create({ name: 'Bravo Team' }));

      const mod = await createAndSignInUser(app, userRepo, authService, 'mod.bravo@intraflow.dev', UserRole.EMPLOYEE, 'Mod Bravo');
      modUser = mod.user;
      modCookies = mod.cookies;

      const mem = await createAndSignInUser(app, userRepo, authService, 'mem.bravo@intraflow.dev', UserRole.EMPLOYEE, 'Mem Bravo');
      memberUser = mem.user;

      const cand = await createAndSignInUser(app, userRepo, authService, 'cand.bravo@intraflow.dev', UserRole.EMPLOYEE, 'Cand Bravo');
      candidateUser = cand.user;

      // Add moderator to Bravo Team as MODERATOR
      await membershipRepo.save(
        membershipRepo.create({
          teamId: team.teamId,
          userId: modUser.userId,
          role: TeamMemberRole.MODERATOR,
        }),
      );

      // Re-sign in moderator to refresh session/currentUser
      const modRefresh = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: modUser.email, password: 'Password123!' });
      modCookies = (modRefresh.get('Set-Cookie') ?? []);
    });

    it('Moderator adds a user as MEMBER (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/teams/${team.teamId}/members`)
        .set('Cookie', modCookies)
        .send({ userId: memberUser.userId, role: TeamMemberRole.MEMBER });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(memberUser.userId);
      expect(res.body.role).toBe(TeamMemberRole.MEMBER);
    });

    it('Moderator cannot add another MODERATOR (403)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/teams/${team.teamId}/members`)
        .set('Cookie', modCookies)
        .send({ userId: candidateUser.userId, role: TeamMemberRole.MODERATOR });

      expect(res.status).toBe(403);
    });

    it('Moderator cannot change roles on the roster (403)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/teams/${team.teamId}/members/${memberUser.userId}`)
        .set('Cookie', modCookies)
        .send({ role: TeamMemberRole.MODERATOR });

      expect(res.status).toBe(403);
    });

    it('Moderator cannot remove themselves or another moderator (403)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/teams/${team.teamId}/members/${modUser.userId}`)
        .set('Cookie', modCookies);

      expect(res.status).toBe(403);
    });

    it('Moderator can remove a MEMBER (204)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/teams/${team.teamId}/members/${memberUser.userId}`)
        .set('Cookie', modCookies);

      expect(res.status).toBe(204);
    });

    it('Admin can add any user as MODERATOR and change roles', async () => {
      // Admin adds candidate as MODERATOR
      const addRes = await request(app.getHttpServer())
        .post(`/teams/${team.teamId}/members`)
        .set('Cookie', adminCookies)
        .send({ userId: candidateUser.userId, role: TeamMemberRole.MODERATOR });

      expect(addRes.status).toBe(201);
      expect(addRes.body.role).toBe(TeamMemberRole.MODERATOR);

      // Admin changes candidate role to MEMBER
      const patchRes = await request(app.getHttpServer())
        .patch(`/teams/${team.teamId}/members/${candidateUser.userId}`)
        .set('Cookie', adminCookies)
        .send({ role: TeamMemberRole.MEMBER });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.role).toBe(TeamMemberRole.MEMBER);

      // Cleanup candidate
      await request(app.getHttpServer())
        .delete(`/teams/${team.teamId}/members/${candidateUser.userId}`)
        .set('Cookie', adminCookies);
    });
  });

  describe('3. One-Team-Per-User Constraint (API & Direct DB)', () => {
    let team1: Team;
    let team2: Team;
    let singleUser: User;

    beforeAll(async () => {
      team1 = await teamRepo.save(teamRepo.create({ name: 'Constraint Team 1' }));
      team2 = await teamRepo.save(teamRepo.create({ name: 'Constraint Team 2' }));

      const u = await createAndSignInUser(app, userRepo, authService, 'single.user@intraflow.dev', UserRole.EMPLOYEE, 'Single User');
      singleUser = u.user;

      // Add to team1
      await request(app.getHttpServer())
        .post(`/teams/${team1.teamId}/members`)
        .set('Cookie', adminCookies)
        .send({ userId: singleUser.userId, role: TeamMemberRole.MEMBER });
    });

    it('Adding user to a second team via API returns 409', async () => {
      const res = await request(app.getHttpServer())
        .post(`/teams/${team2.teamId}/members`)
        .set('Cookie', adminCookies)
        .send({ userId: singleUser.userId, role: TeamMemberRole.MEMBER });

      expect(res.status).toBe(409);
    });

    it('Direct DB insert attempt for a second team fails with unique constraint violation', async () => {
      const duplicate = membershipRepo.create({
        teamId: team2.teamId,
        userId: singleUser.userId,
        role: TeamMemberRole.MEMBER,
      });

      await expect(membershipRepo.save(duplicate)).rejects.toThrow();
    });

    it('Adding an admin to a team returns 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/teams/${team1.teamId}/members`)
        .set('Cookie', adminCookies)
        .send({ userId: adminUser.userId });

      expect(res.status).toBe(400);
    });

    it('Adding a nonexistent or soft-deleted user returns 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/teams/${team1.teamId}/members`)
        .set('Cookie', adminCookies)
        .send({ userId: 99999 });

      expect(res.status).toBe(404);
    });
  });

  describe('4. Team Deletion Protection (Members & Projects)', () => {
    let teamWithMember: Team;
    let teamWithProject: Team;
    let emptyTeam: Team;

    beforeAll(async () => {
      teamWithMember = await teamRepo.save(teamRepo.create({ name: 'Team With Member' }));
      teamWithProject = await teamRepo.save(teamRepo.create({ name: 'Team With Project' }));
      emptyTeam = await teamRepo.save(teamRepo.create({ name: 'Empty Team' }));

      const dummyUser = await createAndSignInUser(app, userRepo, authService, 'dummy.delete@intraflow.dev', UserRole.EMPLOYEE, 'Dummy');
      await membershipRepo.save(membershipRepo.create({ teamId: teamWithMember.teamId, userId: dummyUser.user.userId }));

      await projectRepo.save(projectRepo.create({
        name: 'Project Blocking Team Deletion',
        teamId: teamWithProject.teamId,
        createdBy: adminUser.userId,
      }));
    });

    it('Deleting a team with active members returns 409', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/teams/${teamWithMember.teamId}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(409);
    });

    it('Deleting a team with active projects returns 409', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/teams/${teamWithProject.teamId}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(409);
    });

    it('Deleting an empty team succeeds with 204 (soft deleted)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/teams/${emptyTeam.teamId}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(204);

      const inDb = await teamRepo.findOne({ where: { teamId: emptyTeam.teamId } });
      expect(inDb).toBeNull(); // soft deleted
    });

    it('Reusing the name of a soft-deleted team returns 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post('/teams')
        .set('Cookie', adminCookies)
        .send({ name: emptyTeam.name });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain(`Team with name "${emptyTeam.name}" already exists`);
    });
  });

  describe('5. Invite with TeamId and Transactional Membership', () => {
    let inviteTeam: Team;

    beforeAll(async () => {
      inviteTeam = await teamRepo.save(teamRepo.create({ name: 'Invite Onboarding Team' }));
    });

    it('Invite with invalid teamId returns 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Cookie', adminCookies)
        .send({ email: 'invalid.team.invite@intraflow.dev', teamId: 99999 });

      expect(res.status).toBe(404);
    });

    it('Invite with valid teamId creates user and membership in same signup transaction', async () => {
      const inviteRes = await request(app.getHttpServer())
        .post('/users/invite')
        .set('Cookie', adminCookies)
        .send({ email: 'team.signup@intraflow.dev', teamId: inviteTeam.teamId });

      expect(inviteRes.status).toBe(201);
      const token = inviteRes.body.token;

      // Signup with the token
      const signupRes = await request(app.getHttpServer())
        .post(`/auth/signup?token=${token}`)
        .send({
          name: 'Team Signer',
          email: 'team.signup@intraflow.dev',
          password: 'Password123!',
        });

      expect(signupRes.status).toBe(201);

      // Verify user and membership exist in DB
      const user = await userRepo.findOne({
        where: { email: 'team.signup@intraflow.dev' },
        relations: ['membership'],
      });

      expect(user).toBeDefined();
      expect(user?.membership).toBeDefined();
      expect(user?.membership?.teamId).toBe(inviteTeam.teamId);
      expect(user?.membership?.role).toBe(TeamMemberRole.MEMBER);
    });
  });
});
