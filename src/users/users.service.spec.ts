import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EntityManager, FindManyOptions, FindOneOptions, Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User, UserRole } from './entities/user.entity';
import { Invited } from './entities/invited.entity';
import { EmailChangeRequest } from './entities/email-change-request.entity';
import { MailService } from '../mail/mail.service';
import { hashPassword } from '../auth/password-hasher';

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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockImplementation((u) => Promise.resolve(u)),
    };

    const mockManager = {
      findOne: jest.fn((_cls: unknown, options?: FindOneOptions<User>) => {
        if (usersRepo.findOne) {
          const res = (usersRepo.findOne as jest.Mock)(options);
          if (res !== undefined) return res;
        }
        return Promise.resolve(null);
      }),
      count: jest.fn((_cls: unknown, options?: FindManyOptions<User>) => usersRepo.count!(options)),
      softDelete: jest.fn((_cls: unknown, id: number) => usersRepo.softDelete!(id)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setLock: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([new User({ userId: 2, role: UserRole.ADMIN })]),
      })),
      save: jest.fn().mockImplementation((_clsOrEntity, entity) => Promise.resolve(entity || _clsOrEntity)),
      create: jest.fn((entityClass, dto) => dto),
      getRepository: jest.fn(() => ({
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        save: jest.fn().mockResolvedValue({ id: 1 }),
        create: jest.fn((dto) => dto),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        {
          provide: getRepositoryToken(Invited),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
            create: jest.fn((dto) => dto),
            save: jest.fn((dto) => Promise.resolve({ ...dto, token: 'invite-token-123' })),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(EmailChangeRequest),
          useValue: {
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            save: jest.fn().mockResolvedValue({ id: 1 }),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendInvitation: jest.fn(),
            sendEmailChangeVerification: jest.fn(),
            sendEmailChangeNotice: jest.fn(),
          },
        },
        {
          provide: EntityManager,
          useValue: {
            transaction: jest.fn((cb) => cb(mockManager)),
            findOne: jest.fn(),
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    usersService = module.get<UsersService>(UsersService);
  });

  it('findAll returns paginated envelope without throwing NotFoundException when no users exist', async () => {
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
    usersRepo.createQueryBuilder!.mockReturnValue(mockQb as never);
    const result = await usersService.findAll();
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('findOne does not leak password hash', async () => {
    usersRepo.findOne!.mockResolvedValue(
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

  describe('invite & registerWithInvite', () => {
    it('invite throws ConflictException if user with email already exists', async () => {
      usersRepo.findOne!.mockResolvedValue(new User({ userId: 10, email: 'exists@intraflow.dev' }));
      await expect(
        usersService.invite('exists@intraflow.dev', UserRole.EMPLOYEE),
      ).rejects.toThrow(ConflictException);
    });

    it('registerWithInvite throws NotFoundException if token does not exist', async () => {
      const entityManager = (usersService as unknown as { entityManager: EntityManager }).entityManager;
      jest.spyOn(entityManager, 'transaction').mockImplementation((cb) => {
        const mockManager = {
          findOne: jest.fn().mockResolvedValue(null),
        };
        return cb(mockManager as never);
      });

      await expect(
        usersService.registerWithInvite('invalid-token', {
          name: 'Bob',
          email: 'bob@intraflow.dev',
          password: 'Password123!',
        }, 'hashed'),
      ).rejects.toThrow(NotFoundException);
    });

    it('registerWithInvite throws 410 Gone if token has expired', async () => {
      const entityManager = (usersService as unknown as { entityManager: EntityManager }).entityManager;
      const expiredInvite = new Invited({
        token: 'exp-token',
        email: 'exp@intraflow.dev',
        expiresAt: new Date(Date.now() - 60000),
      });

      jest.spyOn(entityManager, 'transaction').mockImplementation((cb) => {
        const mockManager = {
          findOne: jest.fn().mockResolvedValue(expiredInvite),
        };
        return cb(mockManager as never);
      });

      await expect(
        usersService.registerWithInvite('exp-token', {
          name: 'Expired',
          email: 'exp@intraflow.dev',
          password: 'Password123!',
        }, 'hashed'),
      ).rejects.toThrow(new HttpException('Invite has expired', HttpStatus.GONE));
    });
  });

  describe('update', () => {
    it('calls usersRepository.update with userId and dto', async () => {
      const res = await usersService.update(1, { name: 'New Name' });
      expect(usersRepo.update).toHaveBeenCalledWith(1, { name: 'New Name' });
      expect(res.affected).toBe(1);
    });
  });

  describe('changePassword', () => {
    it('throws UnauthorizedException when current password does not match', async () => {
      const hashed = await hashPassword('CorrectPass123!');
      const mockQb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(new User({ userId: 1, password: hashed })),
      };
      usersRepo.createQueryBuilder!.mockReturnValue(mockQb as never);

      await expect(
        usersService.changePassword(1, {
          currentPassword: 'WrongPass!',
          newPassword: 'BrandNewPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when new password equals current password', async () => {
      const hashed = await hashPassword('SamePassword123!');
      const mockQb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(new User({ userId: 1, password: hashed })),
      };
      usersRepo.createQueryBuilder!.mockReturnValue(mockQb as never);

      await expect(
        usersService.changePassword(1, {
          currentPassword: 'SamePassword123!',
          newPassword: 'SamePassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully changes password and updates session iat', async () => {
      const hashed = await hashPassword('CurrentPassword123!');
      const user = new User({ userId: 1, password: hashed });
      const mockQb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(user),
      };
      usersRepo.createQueryBuilder!.mockReturnValue(mockQb as never);
      usersRepo.save = jest.fn().mockResolvedValue(user);

      const session = { userId: 1, role: UserRole.EMPLOYEE, iat: 1000 };
      const res = await usersService.changePassword(
        1,
        {
          currentPassword: 'CurrentPassword123!',
          newPassword: 'BrandNewPassword123!',
        },
        session as never,
      );

      expect(res.message).toContain('Password updated successfully');
      expect(user.sessionsValidFrom).toBeDefined();
      expect(session.iat).toBeGreaterThan(1000);
    });
  });

  describe('requestEmailChange & confirmEmailChange', () => {
    it('requestEmailChange throws BadRequestException when new email is identical to current email', async () => {
      const hashed = await hashPassword('CurrentPassword123!');
      const mockQb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(
          new User({ userId: 1, email: 'same@intraflow.dev', password: hashed }),
        ),
      };
      usersRepo.createQueryBuilder!.mockReturnValue(mockQb as never);

      await expect(
        usersService.requestEmailChange(1, {
          currentPassword: 'CurrentPassword123!',
          newEmail: 'same@intraflow.dev',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('confirmEmailChange throws BadRequestException when token is invalid or expired', async () => {
      const entityManager = (usersService as unknown as { entityManager: EntityManager }).entityManager;
      jest.spyOn(entityManager, 'transaction').mockImplementation((cb) => {
        const mockManager = {
          getRepository: jest.fn().mockReturnValue({
            findOne: jest.fn().mockResolvedValue(null),
          }),
        };
        return cb(mockManager as never);
      });

      await expect(
        usersService.confirmEmailChange({ token: 'nonexistent-token' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('confirmEmailChange successfully updates email and sends notification', async () => {
      const entityManager = (usersService as unknown as { entityManager: EntityManager }).entityManager;
      const targetUser = new User({ userId: 1, email: 'old@intraflow.dev' });
      const changeRequest = {
        userId: 1,
        newEmail: 'new@intraflow.dev',
        usedAt: null,
        expiresAt: new Date(Date.now() + 100000),
      };

      jest.spyOn(entityManager, 'transaction').mockImplementation((cb) => {
        const mockManager = {
          getRepository: jest.fn((entity) => {
            if (entity === EmailChangeRequest) {
              return {
                findOne: jest.fn().mockResolvedValue(changeRequest),
                save: jest.fn().mockResolvedValue(changeRequest),
              };
            }
            return {
              findOne: jest.fn((opts) => {
                if (opts?.where?.email) return Promise.resolve(null);
                return Promise.resolve(targetUser);
              }),
              save: jest.fn().mockResolvedValue(targetUser),
            };
          }),
        };
        return cb(mockManager as never);
      });

      const res = await usersService.confirmEmailChange({ token: 'valid-token' });
      expect(res.message).toContain('Email address successfully updated');
      expect(targetUser.email).toBe('new@intraflow.dev');
    });

    it('requestEmailChange succeeds and sends verification email', async () => {
      const hashed = await hashPassword('CurrentPassword123!');
      usersRepo.findOne!.mockImplementation((opts: any) => {
        if (opts?.where?.userId === 1) {
          return Promise.resolve(
            new User({ userId: 1, email: 'current@intraflow.dev', password: hashed }),
          );
        }
        return Promise.resolve(null);
      });
      const mockQb = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest
          .fn()
          .mockResolvedValueOnce(
            new User({ userId: 1, email: 'current@intraflow.dev', password: hashed }),
          )
          .mockResolvedValueOnce(null),
      };
      usersRepo.createQueryBuilder!.mockReturnValue(mockQb as never);

      const res = await usersService.requestEmailChange(1, {
        currentPassword: 'CurrentPassword123!',
        newEmail: 'newbrand@intraflow.dev',
      });
      expect(res.message).toContain('Verification email sent');
    });
  });

  describe('findAll with filters', () => {
    it('returns filtered and sorted users', async () => {
      const user = new User({ userId: 1, name: 'Alice', email: 'alice@intraflow.dev' });
      const mockQb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([user]),
      };
      usersRepo.createQueryBuilder!.mockReturnValue(mockQb as never);

      const res = await usersService.findAll({
        page: 1,
        limit: 10,
        role: UserRole.EMPLOYEE,
        teamId: 5,
        search: 'Alice',
        sort: 'name:desc',
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0].name).toBe('Alice');
      expect(res.meta.total).toBe(1);
    });
  });
});
