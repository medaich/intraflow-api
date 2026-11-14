import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User, UserRole } from './entities/user.entity';
import { Invited } from './entities/invited.entity';

describe('UsersService (Unit Tests)', () => {
  let usersService: UsersService;
  let usersRepo: jest.Mocked<Partial<Repository<User>>>;

  beforeEach(async () => {
    usersRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      count: jest.fn(),
      softDelete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(Invited), useValue: {} },
        { provide: EntityManager, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    usersService = module.get<UsersService>(UsersService);
  });

  it('findAll returns empty array without throwing NotFoundException when no users exist', async () => {
    usersRepo.find!.mockResolvedValue([]);
    const result = await usersService.findAll();
    expect(result).toEqual([]);
  });

  it('findOne does not leak password hash', async () => {
    usersRepo.findOneBy!.mockResolvedValue(
      new User({ userId: 1, email: 'test@example.com', password: 'secret_hash' }),
    );
    const user = await usersService.findOne({ userId: 1 });
    expect(user?.password).toBeUndefined();
  });

  it('findByEmailWithPassword explicitly uses addSelect to load password hash for auth', async () => {
    const mockQueryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(
        new User({ userId: 1, email: 'test@example.com', password: 'secret_hash' }),
      ),
    };
    usersRepo.createQueryBuilder!.mockReturnValue(mockQueryBuilder as never);

    const user = await usersService.findByEmailWithPassword('test@example.com');
    expect(mockQueryBuilder.addSelect).toHaveBeenCalledWith('user.password');
    expect(user?.password).toBe('secret_hash');
  });

  describe('Admin Deletion Rules & Last Admin Protection', () => {
    it('throws BadRequestException when admin attempts self-deletion', async () => {
      await expect(usersService.remove(1, 1)).rejects.toThrow(
        new BadRequestException('Admins cannot delete their own account'),
      );
    });

    it('throws BadRequestException when deleting the last remaining admin (last-admin rule fires)', async () => {
      // In this test, currentAdminId is omitted (e.g. called from programmatic service/system task)
      // or calling admin is different. The target user is an ADMIN, and total admin count is 1.
      usersRepo.findOne!.mockResolvedValue(
        new User({ userId: 2, role: UserRole.ADMIN }),
      );
      usersRepo.count!.mockResolvedValue(1);

      await expect(usersService.remove(2)).rejects.toThrow(
        new BadRequestException('Cannot delete the last remaining administrator'),
      );
    });
  });
});
