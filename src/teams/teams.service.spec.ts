/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
      createQueryBuilder: jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
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
      await expect(service.remove(10)).rejects.toThrow(ConflictException);
    });

    it('throws 409 if team still has projects', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      membershipRepo.count.mockResolvedValue(0);
      projectRepo.count.mockResolvedValue(1);
      await expect(service.remove(10)).rejects.toThrow(ConflictException);
    });

    it('soft deletes team when 0 members and 0 projects', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      membershipRepo.count.mockResolvedValue(0);
      projectRepo.count.mockResolvedValue(0);
      await service.remove(10);
      expect(teamRepo.softDelete).toHaveBeenCalledWith(10);
    });
  });

  describe('findAll', () => {
    it('returns paginated teams with member counts', async () => {
      const mockQb = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockTeam]),
      };
      teamRepo.createQueryBuilder = jest.fn().mockReturnValue(mockQb as never);
      teamRepo.find.mockResolvedValue([
        new Team({
          ...mockTeam,
          members: [new TeamMembership({ id: 1, teamId: 10, userId: 2 })],
        }),
      ]);

      const membershipQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ teamId: 10, count: '3' }]),
      };
      membershipRepo.createQueryBuilder = jest.fn().mockReturnValue(membershipQb as never);

      const res = await service.findAll(
        { page: 1, limit: 10, search: 'Core', sort: 'name:desc' },
        mockAdminUser,
      );

      expect(res.data).toHaveLength(1);
      expect(res.data[0].members).toHaveLength(1);
      expect(res.meta.total).toBe(1);
    });
  });

  describe('addMember and updateMemberRole', () => {
    it('addMember throws BadRequestException if adding an admin', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      userRepo.findOne.mockResolvedValue(mockAdminUser);

      await expect(
        service.addMember(mockAdminUser, 10, { userId: 1, role: TeamMemberRole.MEMBER }),
      ).rejects.toThrow(BadRequestException);
    });

    it('addMember throws ConflictException if user already has membership', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      const userWithTeam = new User({
        userId: 3,
        role: UserRole.EMPLOYEE,
        membership: new TeamMembership({ id: 5, teamId: 99, userId: 3 }),
      });
      userRepo.findOne.mockResolvedValue(userWithTeam);

      await expect(
        service.addMember(mockAdminUser, 10, { userId: 3, role: TeamMemberRole.MEMBER }),
      ).rejects.toThrow(ConflictException);
    });

    it('addMember adds member successfully', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      userRepo.findOne.mockResolvedValue(mockEmployeeUser);
      membershipRepo.findOne.mockResolvedValue(null);
      membershipRepo.save.mockResolvedValue(
        new TeamMembership({ id: 1, teamId: 10, userId: 2, role: TeamMemberRole.MEMBER }),
      );

      const res = await service.addMember(mockAdminUser, 10, { userId: 2, role: TeamMemberRole.MEMBER });
      expect(res.userId).toBe(2);
    });

    it('updateMemberRole throws ForbiddenException if non-admin', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      const memberCaller = new User({
        userId: 20,
        role: UserRole.EMPLOYEE,
        membership: new TeamMembership({ id: 9, teamId: 10, role: TeamMemberRole.MEMBER }),
      });
      await expect(
        service.updateMemberRole(memberCaller, 10, 2, { role: TeamMemberRole.MODERATOR }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updateMemberRole succeeds for admin', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      const membership = new TeamMembership({ id: 1, teamId: 10, userId: 2, role: TeamMemberRole.MEMBER });
      membershipRepo.findOne.mockResolvedValue(membership);
      membershipRepo.save.mockResolvedValue({ ...membership, role: TeamMemberRole.MODERATOR });

      const res = await service.updateMemberRole(mockAdminUser, 10, 2, { role: TeamMemberRole.MODERATOR });
      expect(res.role).toBe(TeamMemberRole.MODERATOR);
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

  describe('findOne & findMyTeam & update', () => {
    it('findOne throws NotFoundException when team does not exist', async () => {
      teamRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('findOne returns team with members', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      const res = await service.findOne(10, mockAdminUser);
      expect(res.teamId).toBe(10);
    });

    it('findMyTeam throws NotFoundException when user has no team', async () => {
      const userNoTeam = new User({ userId: 5, membership: null });
      await expect(service.findMyTeam(userNoTeam)).rejects.toThrow(NotFoundException);
    });

    it('findMyTeam returns team when user belongs to a team', async () => {
      const userWithTeam = new User({
        userId: 2,
        membership: { teamId: 10 } as TeamMembership,
      });
      teamRepo.findOne.mockResolvedValue(mockTeam);
      const res = await service.findMyTeam(userWithTeam);
      expect(res.teamId).toBe(10);
    });

    it('update throws ConflictException if new name already taken', async () => {
      teamRepo.findOne
        .mockResolvedValueOnce(mockTeam) // target team
        .mockResolvedValueOnce(new Team({ teamId: 20, name: 'Taken' })); // existing other team

      await expect(service.update(10, { name: 'Taken' })).rejects.toThrow(ConflictException);
    });

    it('update succeeds for valid changes', async () => {
      teamRepo.findOne
        .mockResolvedValueOnce(mockTeam)
        .mockResolvedValueOnce(null);

      const updated = await service.update(10, { description: 'Updated description' });
      expect(updated.description).toBe('Updated description');
    });
  });

  describe('removeMember', () => {
    it('throws NotFoundException if user is not in team', async () => {
      membershipRepo.findOne.mockResolvedValue(null);
      await expect(service.removeMember(mockAdminUser, 10, 99)).rejects.toThrow(NotFoundException);
    });

    it('removes member, unassigns in-progress tasks, and adds system comment', async () => {
      teamRepo.findOne.mockResolvedValue(mockTeam);
      const membership = new TeamMembership({ id: 1, userId: 2, teamId: 10 });
      membershipRepo.findOne.mockResolvedValue(membership);

      const inProgressTask = new Task({
        taskId: 100,
        status: 'IN_PROGRESS' as never,
        assignedTo: mockEmployeeUser,
      });

      (entityManager.createQueryBuilder as jest.Mock).mockReturnValue({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([inProgressTask]),
      });

      await service.removeMember(mockAdminUser, 10, 2);
      expect(entityManager.delete).toHaveBeenCalledWith(TeamMembership, { id: 1 });
      expect(inProgressTask.status).toBe('UNASSIGNED');
    });
  });
});
