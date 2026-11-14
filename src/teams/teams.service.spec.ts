/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { TeamsService } from './teams.service';
import { Team } from './entities/team.entity';
import { TeamMembership, TeamMemberRole } from './entities/team-membership.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { Project } from '../projects/entities/project.entity';
import { Task } from '../tasks/entities/task.entity';
import { Comment } from '../tasks/entities/comment.entity';
import { AccessPolicyService } from '../auth/policy/access-policy.service';

describe('TeamsService (Unit Tests)', () => {
  let service: TeamsService;
  let teamRepo: jest.Mocked<Repository<Team>>;
  let membershipRepo: jest.Mocked<Repository<TeamMembership>>;
  let userRepo: jest.Mocked<Repository<User>>;
  let projectRepo: jest.Mocked<Repository<Project>>;
  let entityManager: jest.Mocked<EntityManager>;

  const mockAdminUser = new User({
    userId: 1,
    name: 'Admin',
    role: UserRole.ADMIN,
  });

  const mockEmployeeUser = new User({
    userId: 2,
    name: 'Employee One',
    role: UserRole.EMPLOYEE,
    membership: null,
  });

  const mockTeam = new Team({
    teamId: 10,
    name: 'Core Team',
    description: 'Main team',
    members: [],
    projects: [],
  });

  beforeEach(async () => {
    const mockRepoFactory = () => ({
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve({ ...entity, teamId: entity.teamId ?? 10 })),
      softDelete: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    });

    entityManager = {
      transaction: jest.fn((cb: (manager: EntityManager) => Promise<unknown>) => cb(entityManager)),
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((entityClass, dto) => ({ ...dto })),
      save: jest.fn((entityClass, dto) => Promise.resolve(dto)),
      delete: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        AccessPolicyService,
        { provide: getRepositoryToken(Team), useFactory: mockRepoFactory },
        { provide: getRepositoryToken(TeamMembership), useFactory: mockRepoFactory },
        { provide: getRepositoryToken(User), useFactory: mockRepoFactory },
        { provide: getRepositoryToken(Project), useFactory: mockRepoFactory },
        { provide: getRepositoryToken(Task), useFactory: mockRepoFactory },
        { provide: getRepositoryToken(Comment), useFactory: mockRepoFactory },
        { provide: EntityManager, useValue: entityManager },
      ],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
    teamRepo = module.get(getRepositoryToken(Team));
    membershipRepo = module.get(getRepositoryToken(TeamMembership));
    userRepo = module.get(getRepositoryToken(User));
    projectRepo = module.get(getRepositoryToken(Project));
  });

  describe('createTeam', () => {
    it('creates a new team with unique name', async () => {
      teamRepo.findOne.mockResolvedValue(null);
      const team = await service.create({ name: 'Alpha' });
      expect(team.name).toBe('Alpha');
      expect(teamRepo.save).toHaveBeenCalled();
    });

    it('throws ConflictException (409) if team name already exists', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      await expect(service.create({ name: 'Core Team' })).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteTeam', () => {
    it('throws 409 if team still has members', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      membershipRepo.count.mockResolvedValue(2);
      projectRepo.count.mockResolvedValue(0);

      await expect(service.remove(10)).rejects.toThrow(ConflictException);
    });

    it('throws 409 if team still has projects', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      membershipRepo.count.mockResolvedValue(0);
      projectRepo.count.mockResolvedValue(1);

      await expect(service.remove(10)).rejects.toThrow(ConflictException);
    });

    it('soft deletes team if it has 0 members and 0 projects', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      membershipRepo.count.mockResolvedValue(0);
      projectRepo.count.mockResolvedValue(0);

      await service.remove(10);
      expect(teamRepo.softDelete).toHaveBeenCalledWith(10);
    });
  });

  describe('addMember', () => {
    it('rejects adding an admin to a team with 400', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      userRepo.findOne.mockResolvedValue(mockAdminUser);

      await expect(
        service.addMember(mockAdminUser, 10, { userId: 1, role: TeamMemberRole.MEMBER }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects adding a user who already belongs to a team with 409', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      userRepo.findOne.mockResolvedValue(mockEmployeeUser);
      membershipRepo.findOne.mockResolvedValue(
        new TeamMembership({ id: 1, userId: 2, teamId: 99 }),
      );

      await expect(
        service.addMember(mockAdminUser, 10, { userId: 2, role: TeamMemberRole.MEMBER }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects adding a nonexistent or soft-deleted user with 404', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.addMember(mockAdminUser, 10, { userId: 999, role: TeamMemberRole.MEMBER }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
