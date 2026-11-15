import { Test, TestingModule } from '@nestjs/testing';
import { AccessPolicyService } from './access-policy.service';
import { User, UserRole } from '../../users/entities/user.entity';
import { Team } from '../../teams/entities/team.entity';
import { TeamMembership, TeamMemberRole } from '../../teams/entities/team-membership.entity';
import { Project, ProjectStatus } from '../../projects/entities/project.entity';
import { Task, TaskStatus } from '../../tasks/entities/task.entity';

describe('AccessPolicyService', () => {
  let policyService: AccessPolicyService;

  const teamA: Team = {
    teamId: 1,
    name: 'Team Alpha',
    description: 'Alpha team',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    members: [],
    projects: [],
  };

  const teamB: Team = {
    teamId: 2,
    name: 'Team Beta',
    description: 'Beta team',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    members: [],
    projects: [],
  };

  const adminUser = new User({
    userId: 1,
    name: 'Admin User',
    email: 'admin@intraflow.dev',
    role: UserRole.ADMIN,
  });

  const moderatorA = new User({
    userId: 2,
    name: 'Mod Alpha',
    email: 'mod.a@intraflow.dev',
    role: UserRole.EMPLOYEE,
    membership: {
      id: 1,
      userId: 2,
      teamId: 1,
      role: TeamMemberRole.MODERATOR,
      createdAt: new Date(),
    } as TeamMembership,
  });

  const memberA = new User({
    userId: 3,
    name: 'Member Alpha',
    email: 'member.a@intraflow.dev',
    role: UserRole.EMPLOYEE,
    membership: {
      id: 2,
      userId: 3,
      teamId: 1,
      role: TeamMemberRole.MEMBER,
      createdAt: new Date(),
    } as TeamMembership,
  });

  const moderatorB = new User({
    userId: 4,
    name: 'Mod Beta',
    email: 'mod.b@intraflow.dev',
    role: UserRole.EMPLOYEE,
    membership: {
      id: 3,
      userId: 4,
      teamId: 2,
      role: TeamMemberRole.MODERATOR,
      createdAt: new Date(),
    } as TeamMembership,
  });

  const employeeNoTeam = new User({
    userId: 5,
    name: 'Unassigned Employee',
    email: 'no.team@intraflow.dev',
    role: UserRole.EMPLOYEE,
    membership: null,
  });

  const projectA: Project = {
    projectId: 10,
    name: 'Project Alpha',
    description: 'Project in Team A',
    startDate: new Date(),
    endDate: new Date(),
    status: ProjectStatus.ACTIVE,
    teamId: 1,
    team: teamA,
    createdBy: 1,
    creator: adminUser,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    tasks: [],
  };

  const projectB: Project = {
    projectId: 20,
    name: 'Project Beta',
    description: 'Project in Team B',
    startDate: new Date(),
    endDate: new Date(),
    status: ProjectStatus.ACTIVE,
    teamId: 2,
    team: teamB,
    createdBy: 1,
    creator: adminUser,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    tasks: [],
  };

  const standaloneProject: Project = {
    projectId: 30,
    name: 'Standalone Project',
    description: 'Project without team',
    startDate: new Date(),
    endDate: new Date(),
    status: ProjectStatus.ACTIVE,
    teamId: null,
    team: null,
    createdBy: 1,
    creator: adminUser,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    tasks: [],
  };

  const taskInProjectA = new Task({
    taskId: 100,
    name: 'Task 100',
    projectId: 10,
    project: projectA,
    status: TaskStatus.UNASSIGNED,
    assignedTo: null,
  });

  const standaloneTask = new Task({
    taskId: 300,
    name: 'Task 300',
    projectId: null,
    project: null,
    status: TaskStatus.UNASSIGNED,
    assignedTo: null,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AccessPolicyService],
    }).compile();

    policyService = module.get<AccessPolicyService>(AccessPolicyService);
  });

  describe('canViewTeam', () => {
    it('allows Admin to view any team', () => {
      expect(policyService.canViewTeam(adminUser, teamA)).toBe(true);
      expect(policyService.canViewTeam(adminUser, teamB)).toBe(true);
    });

    it('allows moderator or member of Team A to view Team A', () => {
      expect(policyService.canViewTeam(moderatorA, teamA)).toBe(true);
      expect(policyService.canViewTeam(memberA, teamA)).toBe(true);
    });

    it('denies user from Team B or without team from viewing Team A', () => {
      expect(policyService.canViewTeam(moderatorB, teamA)).toBe(false);
      expect(policyService.canViewTeam(employeeNoTeam, teamA)).toBe(false);
    });
  });

  describe('canManageTeamRoster', () => {
    it('allows Admin to manage any roster role (MEMBER and MODERATOR)', () => {
      expect(policyService.canManageTeamRoster(adminUser, teamA, TeamMemberRole.MEMBER)).toBe(true);
      expect(policyService.canManageTeamRoster(adminUser, teamA, TeamMemberRole.MODERATOR)).toBe(true);
    });

    it('allows Team A moderator to manage MEMBER role on Team A', () => {
      expect(policyService.canManageTeamRoster(moderatorA, teamA, TeamMemberRole.MEMBER)).toBe(true);
    });

    it('denies Team A moderator from managing MODERATOR role on Team A', () => {
      expect(policyService.canManageTeamRoster(moderatorA, teamA, TeamMemberRole.MODERATOR)).toBe(false);
    });

    it('denies Team A member, other team moderator, or non-team user from managing roster', () => {
      expect(policyService.canManageTeamRoster(memberA, teamA, TeamMemberRole.MEMBER)).toBe(false);
      expect(policyService.canManageTeamRoster(moderatorB, teamA, TeamMemberRole.MEMBER)).toBe(false);
      expect(policyService.canManageTeamRoster(employeeNoTeam, teamA, TeamMemberRole.MEMBER)).toBe(false);
    });
  });

  describe('canViewProject', () => {
    it('allows Admin to view all projects including standalone', () => {
      expect(policyService.canViewProject(adminUser, projectA)).toBe(true);
      expect(policyService.canViewProject(adminUser, projectB)).toBe(true);
      expect(policyService.canViewProject(adminUser, standaloneProject)).toBe(true);
    });

    it('allows Team A moderator and member to view Team A projects', () => {
      expect(policyService.canViewProject(moderatorA, projectA)).toBe(true);
      expect(policyService.canViewProject(memberA, projectA)).toBe(true);
    });

    it('denies viewing projects of other teams or standalone projects to non-admins', () => {
      expect(policyService.canViewProject(moderatorB, projectA)).toBe(false);
      expect(policyService.canViewProject(employeeNoTeam, projectA)).toBe(false);
      expect(policyService.canViewProject(moderatorA, standaloneProject)).toBe(false);
    });
  });

  describe('canManageProject', () => {
    it('allows Admin to manage any project', () => {
      expect(policyService.canManageProject(adminUser, projectA)).toBe(true);
      expect(policyService.canManageProject(adminUser, standaloneProject)).toBe(true);
    });

    it('denies non-admins from general project management (CRUD/team assignment)', () => {
      expect(policyService.canManageProject(moderatorA, projectA)).toBe(false);
      expect(policyService.canManageProject(memberA, projectA)).toBe(false);
    });
  });

  describe('canManageTask', () => {
    it('allows Admin to manage any task including standalone', () => {
      expect(policyService.canManageTask(adminUser, taskInProjectA)).toBe(true);
      expect(policyService.canManageTask(adminUser, standaloneTask)).toBe(true);
    });

    it('allows Team A moderator to manage tasks in Team A projects', () => {
      expect(policyService.canManageTask(moderatorA, taskInProjectA)).toBe(true);
    });

    it('denies Team A member, other team moderator, or non-team user from managing tasks', () => {
      expect(policyService.canManageTask(memberA, taskInProjectA)).toBe(false);
      expect(policyService.canManageTask(moderatorB, taskInProjectA)).toBe(false);
      expect(policyService.canManageTask(employeeNoTeam, taskInProjectA)).toBe(false);
    });

    it('denies non-admins from managing standalone tasks', () => {
      expect(policyService.canManageTask(moderatorA, standaloneTask)).toBe(false);
    });
  });

  describe('canAssignTask', () => {
    it('allows Admin to assign standalone task to any non-admin employee', () => {
      expect(policyService.canAssignTask(adminUser, standaloneTask, memberA)).toBe(true);
      expect(policyService.canAssignTask(adminUser, standaloneTask, employeeNoTeam)).toBe(true);
    });

    it('denies assigning any task to an Admin', () => {
      expect(policyService.canAssignTask(adminUser, standaloneTask, adminUser)).toBe(false);
      expect(policyService.canAssignTask(adminUser, taskInProjectA, adminUser)).toBe(false);
    });

    it('allows Team A moderator and Admin to assign Team A task to Team A members/moderators', () => {
      expect(policyService.canAssignTask(moderatorA, taskInProjectA, memberA)).toBe(true);
      expect(policyService.canAssignTask(moderatorA, taskInProjectA, moderatorA)).toBe(true);
      expect(policyService.canAssignTask(adminUser, taskInProjectA, memberA)).toBe(true);
    });

    it('denies assigning Team A task to users outside Team A, even by an Admin', () => {
      expect(policyService.canAssignTask(adminUser, taskInProjectA, moderatorB)).toBe(false);
      expect(policyService.canAssignTask(adminUser, taskInProjectA, employeeNoTeam)).toBe(false);
      expect(policyService.canAssignTask(moderatorA, taskInProjectA, moderatorB)).toBe(false);
    });
  });

  describe('canReviewTask', () => {
    it('allows Admin to review any task', () => {
      expect(policyService.canReviewTask(adminUser, taskInProjectA)).toBe(true);
      expect(policyService.canReviewTask(adminUser, standaloneTask)).toBe(true);
    });

    it('allows Team A moderator to review Team A tasks', () => {
      expect(policyService.canReviewTask(moderatorA, taskInProjectA)).toBe(true);
    });

    it('denies Team A member, Team B moderator, and non-team user from reviewing Team A tasks', () => {
      expect(policyService.canReviewTask(memberA, taskInProjectA)).toBe(false);
      expect(policyService.canReviewTask(moderatorB, taskInProjectA)).toBe(false);
      expect(policyService.canReviewTask(employeeNoTeam, taskInProjectA)).toBe(false);
      expect(policyService.canReviewTask(moderatorA, standaloneTask)).toBe(false);
    });
  });

  describe('canModerateComments', () => {
    it('allows Admin to moderate comments on any task', () => {
      expect(policyService.canModerateComments(adminUser, taskInProjectA)).toBe(true);
      expect(policyService.canModerateComments(adminUser, standaloneTask)).toBe(true);
    });

    it('allows Team A moderator to moderate comments on Team A tasks', () => {
      expect(policyService.canModerateComments(moderatorA, taskInProjectA)).toBe(true);
    });

    it('denies Team A member or other team moderator from moderating comments on Team A tasks', () => {
      expect(policyService.canModerateComments(memberA, taskInProjectA)).toBe(false);
      expect(policyService.canModerateComments(moderatorB, taskInProjectA)).toBe(false);
      expect(policyService.canModerateComments(memberA, standaloneTask)).toBe(false);
    });
  });

  describe('canManageAttachments', () => {
    it('allows Admin to manage attachments on any task', () => {
      expect(policyService.canManageAttachments(adminUser, taskInProjectA)).toBe(true);
      expect(policyService.canManageAttachments(adminUser, standaloneTask)).toBe(true);
    });

    it('allows assignee to manage attachments', () => {
      const assignedTask = new Task({ ...taskInProjectA, assignedTo: memberA });
      expect(policyService.canManageAttachments(memberA, assignedTask)).toBe(true);
    });

    it('allows team moderator to manage attachments on team tasks', () => {
      expect(policyService.canManageAttachments(moderatorA, taskInProjectA)).toBe(true);
    });

    it('denies non-assignee member on team task and non-assignee on standalone task', () => {
      expect(policyService.canManageAttachments(memberA, taskInProjectA)).toBe(false);
      expect(policyService.canManageAttachments(memberA, standaloneTask)).toBe(false);
      expect(policyService.canManageAttachments(moderatorA, standaloneTask)).toBe(false);
    });
  });

  describe('canDeleteAttachment', () => {
    it('allows Admin to delete any attachment', () => {
      expect(policyService.canDeleteAttachment(adminUser, { uploadedById: 99 }, taskInProjectA)).toBe(true);
    });

    it('allows uploader to delete own attachment', () => {
      expect(policyService.canDeleteAttachment(memberA, { uploadedById: memberA.userId }, taskInProjectA)).toBe(true);
    });

    it('allows team moderator to delete attachment on team task', () => {
      expect(policyService.canDeleteAttachment(moderatorA, { uploadedById: 99 }, taskInProjectA)).toBe(true);
    });

    it('denies non-uploader non-moderator employee', () => {
      expect(policyService.canDeleteAttachment(memberA, { uploadedById: 99 }, taskInProjectA)).toBe(false);
      expect(policyService.canDeleteAttachment(memberA, { uploadedById: 99 }, standaloneTask)).toBe(false);
      expect(policyService.canDeleteAttachment(moderatorA, { uploadedById: 99 }, standaloneTask)).toBe(false);
    });
  });
});
