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
import { ClockService } from '../common/clock/clock.service';

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
        ClockService,
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

  describe('create and find project', () => {
    it('create throws NotFoundException if specified teamId does not exist', async () => {
      teamRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create({ name: 'New Project', teamId: 999 }, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('create succeeds and returns enriched project', async () => {
      teamRepo.findOne.mockResolvedValue(new Team({ teamId: 10 }));
      projectRepo.save.mockResolvedValue(
        new Project({ projectId: 5, name: 'Saved Project', teamId: 10, tasks: [] }),
      );

      const created = await service.create({ name: 'Saved Project', teamId: 10 }, adminUser);
      expect(created.name).toBe('Saved Project');
      expect(created.progress.percent).toBe(0);
    });

    it('findOne throws NotFoundException if project not found or inaccessible', async () => {
      projectRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(999, adminUser)).rejects.toThrow(NotFoundException);

      projectRepo.findOne.mockResolvedValue(activeProject);
      await expect(service.findOne(1, otherModUser)).rejects.toThrow(NotFoundException);
    });

    it('archive sets project status to ARCHIVED', async () => {
      projectRepo.findOne.mockResolvedValue(activeProject);
      const archived = await service.update(1, { status: ProjectStatus.ARCHIVED }, adminUser);
      expect(archived.status).toBe(ProjectStatus.ARCHIVED);
    });

    it('findAll returns empty envelope when employee has no team', async () => {
      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      projectRepo.createQueryBuilder.mockReturnValue(mockQb as never);
      const userWithoutTeam = new User({ userId: 50, role: UserRole.EMPLOYEE, membership: null });
      const res = await service.findAll({}, userWithoutTeam);
      expect(res.data).toEqual([]);
      expect(res.meta.total).toBe(0);
    });

    it('findAll returns paginated and enriched projects for admin with filters', async () => {
      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([activeProject]),
      };
      projectRepo.createQueryBuilder.mockReturnValue(mockQb as never);

      const taskQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ projectId: 1, total: '2', completed: '1' }]),
      };
      taskRepo.createQueryBuilder.mockReturnValue(taskQb as never);

      const res = await service.findAll(
        { page: 1, limit: 10, teamId: 10, status: ProjectStatus.ACTIVE, search: 'Proj', sort: 'name:desc' },
        adminUser,
      );

      expect(res.data).toHaveLength(1);
      expect(res.data[0].progress.percent).toBe(50);
      expect(res.meta.total).toBe(1);
    });
  });
});
