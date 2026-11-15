import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { createTestApp, closeTestApp, createAndSignInUser, TestAppBundle } from './test-helper';
import { User, UserRole } from '../src/users/entities/user.entity';
import { Team } from '../src/teams/entities/team.entity';
import { TeamMembership, TeamMemberRole } from '../src/teams/entities/team-membership.entity';
import { Project } from '../src/projects/entities/project.entity';
import { Task, TaskStatus } from '../src/tasks/entities/task.entity';
import { Comment } from '../src/tasks/entities/comment.entity';
import { AuthService } from '../src/auth/auth.service';

describe('Team Removal Side Effects & Atomicity E2E Tests (Real DB)', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let membershipRepo: Repository<TeamMembership>;
  let projectRepo: Repository<Project>;
  let taskRepo: Repository<Task>;
  let commentRepo: Repository<Comment>;
  let entityManager: EntityManager;
  let authService: AuthService;

  let adminCookies: string[];

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = bundle.moduleFixture.get(getRepositoryToken(User));
    teamRepo = bundle.moduleFixture.get(getRepositoryToken(Team));
    membershipRepo = bundle.moduleFixture.get(getRepositoryToken(TeamMembership));
    projectRepo = bundle.moduleFixture.get(getRepositoryToken(Project));
    taskRepo = bundle.moduleFixture.get(getRepositoryToken(Task));
    commentRepo = bundle.moduleFixture.get(getRepositoryToken(Comment));
    entityManager = bundle.moduleFixture.get(EntityManager);
    authService = bundle.moduleFixture.get(AuthService);

    const admin = await createAndSignInUser(app, userRepo, authService, 'admin@intraflow.dev', UserRole.ADMIN, 'Admin');
    adminCookies = admin.cookies;
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  it('Roster removal resets open tasks with system comment and leaves COMPLETED tasks untouched', async () => {
    const team = await teamRepo.save(teamRepo.create({ name: 'Removal Team' }));
    const emp = await createAndSignInUser(app, userRepo, authService, 'removal.emp@intraflow.dev', UserRole.EMPLOYEE, 'Removal Emp');
    const empUser = emp.user;

    await membershipRepo.save(membershipRepo.create({
      teamId: team.teamId,
      userId: empUser.userId,
      role: TeamMemberRole.MEMBER,
    }));

    const project = await projectRepo.save(projectRepo.create({
      name: 'Removal Project',
      teamId: team.teamId,
      createdBy: 1,
    }));

    // Task 1: Open task (IN_PROGRESS)
    const openTask = await taskRepo.save(taskRepo.create({
      name: 'Open Task To Be Reset',
      projectId: project.projectId,
      assignedTo: empUser,
      status: TaskStatus.IN_PROGRESS,
      startDate: new Date(),
      endDate: new Date(),
      startedAt: new Date('2026-01-01T10:00:00Z'),
      submittedAt: null,
    }));

    // Task 2: Completed task (COMPLETED)
    const completedAtDate = new Date('2026-01-02T12:00:00Z');
    const completedTask = await taskRepo.save(taskRepo.create({
      name: 'Completed Task Left Alone',
      projectId: project.projectId,
      assignedTo: empUser,
      status: TaskStatus.COMPLETED,
      startDate: new Date(),
      endDate: new Date(),
      startedAt: new Date('2026-01-01T08:00:00Z'),
      submittedAt: new Date('2026-01-02T11:00:00Z'),
      completedAt: completedAtDate,
    }));

    // Remove member from team
    const removeRes = await request(app.getHttpServer())
      .delete(`/teams/${team.teamId}/members/${empUser.userId}`)
      .set('Cookie', adminCookies);

    expect(removeRes.status).toBe(204);

    // Verify membership deleted
    const memberAfter = await membershipRepo.findOne({ where: { userId: empUser.userId } });
    expect(memberAfter).toBeNull();

    // Verify open task was reset
    const openTaskAfter = await taskRepo.findOne({
      where: { taskId: openTask.taskId },
      relations: ['assignedTo', 'comments'],
    });
    expect(openTaskAfter?.assignedTo).toBeNull();
    expect(openTaskAfter?.status).toBe(TaskStatus.UNASSIGNED);
    expect(openTaskAfter?.startedAt).toBeNull();
    expect(openTaskAfter?.submittedAt).toBeNull();

    // Verify system comment was added
    const comments = await commentRepo.find({
      where: { task: { taskId: openTask.taskId } },
      relations: ['user'],
    });
    expect(comments.length).toBeGreaterThanOrEqual(1);
    const systemComment = comments.find((c) => c.content.includes('[System]'));
    expect(systemComment).toBeDefined();
    expect(systemComment?.user).toBeNull(); // System author is represented as null user

    // Verify completed task was left untouched
    const completedTaskAfter = await taskRepo.findOne({
      where: { taskId: completedTask.taskId },
      relations: ['assignedTo'],
    });
    expect(completedTaskAfter?.status).toBe(TaskStatus.COMPLETED);
    expect(completedTaskAfter?.assignedTo?.userId).toBe(empUser.userId);
    expect(completedTaskAfter?.completedAt).toEqual(completedAtDate);
  });

  it('User soft-deletion resets open tasks and removes membership in a single transaction', async () => {
    const team = await teamRepo.save(teamRepo.create({ name: 'Soft Delete Team' }));
    const emp = await createAndSignInUser(app, userRepo, authService, 'softdel.emp@intraflow.dev', UserRole.EMPLOYEE, 'SoftDel Emp');
    const empUser = emp.user;

    await membershipRepo.save(membershipRepo.create({
      teamId: team.teamId,
      userId: empUser.userId,
      role: TeamMemberRole.MEMBER,
    }));

    const project = await projectRepo.save(projectRepo.create({
      name: 'Soft Delete Project',
      teamId: team.teamId,
      createdBy: 1,
    }));

    const openTask = await taskRepo.save(taskRepo.create({
      name: 'Task of Soft Deleted User',
      projectId: project.projectId,
      assignedTo: empUser,
      status: TaskStatus.IN_REVIEW,
      startDate: new Date(),
      endDate: new Date(),
      startedAt: new Date(),
      submittedAt: new Date(),
    }));

    // Soft delete user via DELETE /users/:userId
    const delRes = await request(app.getHttpServer())
      .delete(`/users/${empUser.userId}`)
      .set('Cookie', adminCookies);

    expect(delRes.status).toBe(200);

    // Membership removed
    const memAfter = await membershipRepo.findOne({ where: { userId: empUser.userId } });
    expect(memAfter).toBeNull();

    // Task reset
    const taskAfter = await taskRepo.findOne({ where: { taskId: openTask.taskId } });
    expect(taskAfter?.assignedTo).toBeNull();
    expect(taskAfter?.status).toBe(TaskStatus.UNASSIGNED);
    expect(taskAfter?.startedAt).toBeNull();
    expect(taskAfter?.submittedAt).toBeNull();

    // System comment added
    const comments = await commentRepo.find({
      where: { task: { taskId: openTask.taskId } },
      relations: ['user'],
    });
    const systemComment = comments.find((c) => c.content.includes('[System]'));
    expect(systemComment).toBeDefined();
    expect(systemComment?.user).toBeNull();
  });

  it('User soft-deletion resets standalone open tasks and adds system comment', async () => {
    const standaloneEmp = await createAndSignInUser(
      app,
      userRepo,
      authService,
      'standalone.emp@intraflow.dev',
      UserRole.EMPLOYEE,
      'Standalone Emp',
    );

    // Admin creates a standalone open task assigned to this employee
    const standaloneTask = await taskRepo.save(
      taskRepo.create({
        name: 'Standalone Open Task',
        assignedTo: standaloneEmp.user,
        status: TaskStatus.IN_PROGRESS,
        startDate: new Date(),
        endDate: new Date(),
        startedAt: new Date(),
      }),
    );

    // Admin soft-deletes the user
    const delRes = await request(app.getHttpServer())
      .delete(`/users/${standaloneEmp.user.userId}`)
      .set('Cookie', adminCookies);

    expect(delRes.status).toBe(200);

    // Verify task is reset to UNASSIGNED and unlinked from user
    const taskAfter = await taskRepo.findOne({
      where: { taskId: standaloneTask.taskId },
      relations: ['assignedTo'],
    });
    expect(taskAfter?.assignedTo).toBeNull();
    expect(taskAfter?.status).toBe(TaskStatus.UNASSIGNED);
    expect(taskAfter?.startedAt).toBeNull();

    // Verify system comment was added
    const comments = await commentRepo.find({
      where: { task: { taskId: standaloneTask.taskId } },
      relations: ['user'],
    });
    const systemComment = comments.find((c) => c.content.includes('[System]'));
    expect(systemComment).toBeDefined();
    expect(systemComment?.isSystem).toBe(true);
    expect(systemComment?.user).toBeNull();
  });

  it('Atomicity: mid-transaction failure rolls back all changes (membership, task, comments)', async () => {
    const team = await teamRepo.save(teamRepo.create({ name: 'Atomicity Team' }));
    const emp = await createAndSignInUser(app, userRepo, authService, 'atomicity.emp@intraflow.dev', UserRole.EMPLOYEE, 'Atomicity Emp');
    const empUser = emp.user;

    const membership = await membershipRepo.save(membershipRepo.create({
      teamId: team.teamId,
      userId: empUser.userId,
      role: TeamMemberRole.MEMBER,
    }));

    const project = await projectRepo.save(projectRepo.create({
      name: 'Atomicity Project',
      teamId: team.teamId,
      createdBy: 1,
    }));

    const task = await taskRepo.save(taskRepo.create({
      name: 'Atomicity Task',
      projectId: project.projectId,
      assignedTo: empUser,
      status: TaskStatus.IN_PROGRESS,
      startDate: new Date(),
      endDate: new Date(),
      startedAt: new Date(),
    }));

    // Attempt simulated atomic transaction with forced error midway
    await expect(
      entityManager.transaction(async (manager) => {
        // Step 1: delete membership
        await manager.delete(TeamMembership, { id: membership.id });

        // Step 2: reset task
        task.assignedTo = null;
        task.status = TaskStatus.UNASSIGNED;
        await manager.save(Task, task);

        // Step 3: force failure
        throw new Error('Simulated database write failure mid-transaction');
      }),
    ).rejects.toThrow('Simulated database write failure mid-transaction');

    // Assert membership still exists (rollback succeeded)
    const memAfter = await membershipRepo.findOne({ where: { id: membership.id } });
    expect(memAfter).toBeDefined();

    // Assert task remains assigned with status IN_PROGRESS (rollback succeeded)
    const taskAfter = await taskRepo.findOne({
      where: { taskId: task.taskId },
      relations: ['assignedTo'],
    });
    expect(taskAfter?.status).toBe(TaskStatus.IN_PROGRESS);
    expect(taskAfter?.assignedTo?.userId).toBe(empUser.userId);
  });
});
