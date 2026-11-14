/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ProjectsService } from './projects.service';
import { Project, ProjectStatus } from './entities/project.entity';
import { Team } from '../teams/entities/team.entity';
import { Task } from '../tasks/entities/task.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { TeamMembership, TeamMemberRole } from '../teams/entities/team-membership.entity';
import { AccessPolicyService } from '../auth/policy/access-policy.service';

describe('ProjectsService (Unit Tests)', () => {
  let service: ProjectsService;
  let projectRepo: jest.Mocked<Repository<Project>>;
  let teamRepo: jest.Mocked<Repository<Team>>;
  let taskRepo: jest.Mocked<Repository<Task>>;

  const adminUser = new User({ userId: 1, role: UserRole.ADMIN });
  const modUser = new User({
    userId: 2,
    role: UserRole.EMPLOYEE,
    membership: { teamId: 10, role: TeamMemberRole.MODERATOR } as TeamMembership,
  });
  const otherModUser = new User({
    userId: 3,
    role: UserRole.EMPLOYEE,
    membership: { teamId: 20, role: TeamMemberRole.MODERATOR } as TeamMembership,
  });

  let activeProject: Project;

  beforeEach(async () => {
    activeProject = new Project({
      projectId: 1,
      name: 'Project One',
      teamId: 10,
      status: ProjectStatus.ACTIVE,
      tasks: [],
    });

    const mockRepoFactory = () => ({
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((p) => Promise.resolve({ ...p, projectId: p.projectId ?? 1 })),
      softDelete: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        AccessPolicyService,
        { provide: getRepositoryToken(Project), useFactory: mockRepoFactory },
        { provide: getRepositoryToken(Team), useFactory: mockRepoFactory },
        { provide: getRepositoryToken(Task), useFactory: mockRepoFactory },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    projectRepo = module.get(getRepositoryToken(Project));
    teamRepo = module.get(getRepositoryToken(Team));
    taskRepo = module.get(getRepositoryToken(Task));
  });

  describe('setProjectTeam', () => {
    it('throws 409 if project has assigned non-COMPLETED tasks when changing/clearing team', async () => {
      projectRepo.findOne.mockResolvedValue(activeProject);
      taskRepo.count.mockResolvedValue(2); // 2 assigned open tasks

      await expect(service.setTeam(1, { teamId: 20 })).rejects.toThrow(ConflictException);
      await expect(service.setTeam(1, { teamId: null })).rejects.toThrow(ConflictException);
    });

    it('allows changing/clearing team if 0 assigned open tasks', async () => {
      projectRepo.findOne.mockResolvedValue(activeProject);
      taskRepo.count.mockResolvedValue(0);
      teamRepo.findOne.mockResolvedValue(new Team({ teamId: 20, name: 'Team 20' }));

      const res = await service.setTeam(1, { teamId: 20 });
      expect(res.teamId).toBe(20);
    });
  });

  describe('deleteProject', () => {
    it('throws 409 if project has tasks', async () => {
      projectRepo.findOne.mockResolvedValue(activeProject);
      taskRepo.count.mockResolvedValue(1);

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
    });

    it('soft deletes project if it has 0 tasks', async () => {
      projectRepo.findOne.mockResolvedValue(activeProject);
      taskRepo.count.mockResolvedValue(0);

      await service.remove(1);
      expect(projectRepo.softDelete).toHaveBeenCalledWith(1);
    });
  });

  describe('setProjectCompleted', () => {
    it('throws 409 if project has incomplete tasks when marking COMPLETED', async () => {
      projectRepo.findOne.mockResolvedValue(activeProject);
      taskRepo.count.mockResolvedValue(1); // 1 task not completed

      await expect(
        service.update(1, { status: ProjectStatus.COMPLETED }, adminUser),
      ).rejects.toThrow(ConflictException);
    });

    it('allows team moderator to mark project COMPLETED if all tasks are COMPLETED', async () => {
      projectRepo.findOne.mockResolvedValue(activeProject);
      taskRepo.count.mockResolvedValue(0);

      const res = await service.update(1, { status: ProjectStatus.COMPLETED }, modUser);
      expect(res.status).toBe(ProjectStatus.COMPLETED);
    });

    it('denies moderator of another team from updating status (returns 404)', async () => {
      projectRepo.findOne.mockResolvedValue(activeProject);

      await expect(
        service.update(1, { status: ProjectStatus.COMPLETED }, otherModUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
