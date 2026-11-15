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
import { Comment } from '../src/tasks/entities/comment.entity';

describe('Task Reject Flow Real-DB E2E Tests', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let membershipRepo: Repository<TeamMembership>;
  let projectRepo: Repository<Project>;
  let taskRepo: Repository<Task>;
  let commentRepo: Repository<Comment>;

  let adminCookies: string[];
  let modCookies: string[];
  let otherModCookies: string[];
  let memberCookies: string[];

  let modUser: User;
  let memberUser: User;
  let team1: Team;
  let team2: Team;
  let project: Project;
  let archivedProject: Project;

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = app.get(getRepositoryToken(User));
    teamRepo = app.get(getRepositoryToken(Team));
    membershipRepo = app.get(getRepositoryToken(TeamMembership));
    projectRepo = app.get(getRepositoryToken(Project));
    taskRepo = app.get(getRepositoryToken(Task));
    commentRepo = app.get(getRepositoryToken(Comment));

    const admin = await createAndSignInUser(app, userRepo, 'reject.admin@intraflow.dev', UserRole.ADMIN);
    adminCookies = admin.cookies;

    team1 = await teamRepo.save(teamRepo.create({ name: 'Reject Flow Team 1' }));
    team2 = await teamRepo.save(teamRepo.create({ name: 'Reject Flow Team 2' }));

    const mod = await createAndSignInUser(app, userRepo, 'reject.mod1@intraflow.dev', UserRole.EMPLOYEE);
    modUser = mod.user;
    modCookies = mod.cookies;
    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: modUser.userId, role: TeamMemberRole.MODERATOR }));

    const otherMod = await createAndSignInUser(app, userRepo, 'reject.othermod@intraflow.dev', UserRole.EMPLOYEE);
    otherModCookies = otherMod.cookies;
    await membershipRepo.save(membershipRepo.create({ teamId: team2.teamId, userId: otherMod.user.userId, role: TeamMemberRole.MODERATOR }));

    const mem = await createAndSignInUser(app, userRepo, 'reject.member1@intraflow.dev', UserRole.EMPLOYEE);
    memberUser = mem.user;
    memberCookies = mem.cookies;
    await membershipRepo.save(membershipRepo.create({ teamId: team1.teamId, userId: memberUser.userId, role: TeamMemberRole.MEMBER }));

    project = await projectRepo.save(projectRepo.create({
      name: 'Reject Active Project',
      teamId: team1.teamId,
      createdBy: admin.user.userId,
      status: ProjectStatus.ACTIVE,
    }));

    archivedProject = await projectRepo.save(projectRepo.create({
      name: 'Reject Archived Project',
      teamId: team1.teamId,
      createdBy: admin.user.userId,
      status: ProjectStatus.ARCHIVED,
    }));
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  it('Reject flow validation: empty reason returns 400 Bad Request', async () => {
    const task = await taskRepo.save(taskRepo.create({
      name: 'Task Empty Reason Test',
      projectId: project.projectId,
      assignedTo: memberUser,
      status: TaskStatus.IN_REVIEW,
      startDate: new Date(),
      endDate: new Date(),
      submittedAt: new Date(),
    }));

    const res = await request(app.getHttpServer())
      .post(`/tasks/${task.taskId}/reject`)
      .set('Cookie', modCookies)
      .send({ reason: '   ' });

    expect(res.status).toBe(400);
  });

  it('Reject flow state transition: rejecting task not in IN_REVIEW returns 409 Conflict', async () => {
    const task = await taskRepo.save(taskRepo.create({
      name: 'Task Not In Review',
      projectId: project.projectId,
      assignedTo: memberUser,
      status: TaskStatus.IN_PROGRESS,
      startDate: new Date(),
      endDate: new Date(),
      startedAt: new Date(),
    }));

    const res = await request(app.getHttpServer())
      .post(`/tasks/${task.taskId}/reject`)
      .set('Cookie', modCookies)
      .send({ reason: 'Need revisions' });

    expect(res.status).toBe(409);
  });

  it('Reject flow: project ARCHIVED returns 409 Conflict', async () => {
    const task = await taskRepo.save(taskRepo.create({
      name: 'Task In Archived Project',
      projectId: archivedProject.projectId,
      assignedTo: memberUser,
      status: TaskStatus.IN_REVIEW,
      startDate: new Date(),
      endDate: new Date(),
      submittedAt: new Date(),
    }));

    const res = await request(app.getHttpServer())
      .post(`/tasks/${task.taskId}/reject`)
      .set('Cookie', adminCookies)
      .send({ reason: 'Cannot reject in archived project' });

    expect(res.status).toBe(409);
  });

  it('Authorization: regular member and other team mod cannot reject (403/404)', async () => {
    const task = await taskRepo.save(taskRepo.create({
      name: 'Task Auth Reject Test',
      projectId: project.projectId,
      assignedTo: memberUser,
      status: TaskStatus.IN_REVIEW,
      startDate: new Date(),
      endDate: new Date(),
      submittedAt: new Date(),
    }));

    // Regular member -> 403
    const memRes = await request(app.getHttpServer())
      .post(`/tasks/${task.taskId}/reject`)
      .set('Cookie', memberCookies)
      .send({ reason: 'Member trying to reject' });
    expect(memRes.status).toBe(403);

    // Other team moderator -> 404 (masked)
    const otherModRes = await request(app.getHttpServer())
      .post(`/tasks/${task.taskId}/reject`)
      .set('Cookie', otherModCookies)
      .send({ reason: 'Other mod trying to reject' });
    expect(otherModRes.status).toBe(404);

    // Standalone task: only admin can reject
    const standaloneTask = await taskRepo.save(taskRepo.create({
      name: 'Standalone Reject Task',
      projectId: null,
      assignedTo: memberUser,
      status: TaskStatus.IN_REVIEW,
      startDate: new Date(),
      endDate: new Date(),
      submittedAt: new Date(),
    }));

    const modStandaloneRes = await request(app.getHttpServer())
      .post(`/tasks/${standaloneTask.taskId}/reject`)
      .set('Cookie', modCookies)
      .send({ reason: 'Mod trying to reject standalone' });
    expect(modStandaloneRes.status).toBe(404);
  });

  it('Full cycle and transactional atomicity: submit -> reject -> submit -> validate', async () => {
    const startedAtTime = new Date('2026-06-01T10:00:00.000Z');
    const task = await taskRepo.save(taskRepo.create({
      name: 'Full Cycle Reject Task',
      projectId: project.projectId,
      assignedTo: memberUser,
      status: TaskStatus.IN_PROGRESS,
      startDate: new Date(),
      endDate: new Date(),
      startedAt: startedAtTime,
    }));

    // 1. Assignee submits task
    const submitRes1 = await request(app.getHttpServer())
      .post(`/tasks/my-tasks/${task.taskId}/submit`)
      .set('Cookie', memberCookies);
    expect(submitRes1.status).toBe(201);
    expect(submitRes1.body.status).toBe(TaskStatus.IN_REVIEW);
    expect(submitRes1.body.submittedAt).toBeDefined();

    // 2. Moderator rejects task with reason
    const rejectionReason = 'Code quality checks failed, please add unit tests.';
    const rejectRes = await request(app.getHttpServer())
      .post(`/tasks/${task.taskId}/reject`)
      .set('Cookie', modCookies)
      .send({ reason: rejectionReason });

    expect(rejectRes.status).toBe(201);
    expect(rejectRes.body.status).toBe(TaskStatus.IN_PROGRESS);
    expect(rejectRes.body.submittedAt).toBeNull();
    // startedAt must remain completely untouched!
    expect(new Date(rejectRes.body.startedAt as string).getTime()).toBe(startedAtTime.getTime());

    // Verify rejection comment in database
    const comments = await commentRepo.find({
      where: { task: { taskId: task.taskId } },
      relations: ['user'],
    });
    expect(comments.length).toBe(1);
    expect(comments[0].content).toBe(rejectionReason);
    expect(comments[0].user?.userId).toBe(modUser.userId);
    expect(comments[0].isSystem).toBe(false);

    // 3. Assignee re-submits task
    const submitRes2 = await request(app.getHttpServer())
      .post(`/tasks/my-tasks/${task.taskId}/submit`)
      .set('Cookie', memberCookies);
    expect(submitRes2.status).toBe(201);
    expect(submitRes2.body.status).toBe(TaskStatus.IN_REVIEW);

    // 4. Moderator validates task -> COMPLETED
    const validateRes = await request(app.getHttpServer())
      .post(`/tasks/${task.taskId}/validate`)
      .set('Cookie', modCookies);
    expect(validateRes.status).toBe(201);
    expect(validateRes.body.status).toBe(TaskStatus.COMPLETED);
    expect(validateRes.body.completedAt).toBeDefined();
  });
});
