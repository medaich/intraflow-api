import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AdminSeedService } from './admin-seed.service';
import { User, UserRole } from '../users/entities/user.entity';
import { AuthService } from '../auth/auth.service';

describe('AdminSeedService (Reconciled Seed & Config Lifecycle)', () => {
  let service: AdminSeedService;
  let userRepo: jest.Mocked<Partial<Repository<User>>>;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let authService: jest.Mocked<Partial<AuthService>>;

  beforeEach(async () => {
    userRepo = {
      count: jest.fn(),
      create: jest.fn().mockImplementation((dto: Partial<User>) => new User(dto)),
      save: jest.fn().mockImplementation((user: User) => Promise.resolve(user)),
    };

    configService = {
      get: jest.fn(),
    };

    authService = {
      hashPassword: jest.fn().mockResolvedValue('v2.mocked_salt.mocked_hash'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSeedService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: ConfigService, useValue: configService },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    service = module.get<AdminSeedService>(AdminSeedService);
  });

  describe('Existing Administrator Behavior', () => {
    it('does not require seed credentials when an administrator already exists (production or dev)', async () => {
      userRepo.count!.mockResolvedValue(1);
      configService.get!.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ADMIN_EMAIL') return undefined;
        if (key === 'ADMIN_PASSWORD') return undefined;
        return undefined;
      });

      // Must succeed without throwing even though credentials are absent in production
      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(userRepo.create).not.toHaveBeenCalled();
      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('Production Missing & Partial Credentials', () => {
    it('throws clear startup error when no admin exists and seed credentials are completely missing in production', async () => {
      userRepo.count!.mockResolvedValue(0);
      configService.get!.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      });

      await expect(service.onApplicationBootstrap()).rejects.toThrow(
        /No administrator exists in database and required seed credentials.*are missing in production/,
      );
    });

    it('throws clear startup error when partial credentials (email only) are provided in production', async () => {
      userRepo.count!.mockResolvedValue(0);
      configService.get!.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ADMIN_EMAIL') return 'admin@intraflow.dev';
        return undefined; // password missing
      });

      await expect(service.onApplicationBootstrap()).rejects.toThrow(
        /Partial administrator seed credentials configured in production/,
      );
    });

    it('throws clear startup error when partial credentials (password only) are provided in production', async () => {
      userRepo.count!.mockResolvedValue(0);
      configService.get!.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ADMIN_PASSWORD') return 'AdminPassword123!';
        return undefined; // email missing
      });

      await expect(service.onApplicationBootstrap()).rejects.toThrow(
        /Partial administrator seed credentials configured in production/,
      );
    });
  });

  describe('Development & Test Missing & Partial Credentials', () => {
    it('skips seeding and logs warning when credentials are completely missing in development', async () => {
      userRepo.count!.mockResolvedValue(0);
      configService.get!.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        return undefined;
      });

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('skips seeding and logs warning when partial credentials are provided in development', async () => {
      userRepo.count!.mockResolvedValue(0);
      configService.get!.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'ADMIN_EMAIL') return 'devadmin@intraflow.dev';
        return undefined; // password missing
      });

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('Successful Seeding Flow', () => {
    it('hashes password and saves initial admin when credentials are fully configured', async () => {
      userRepo.count!.mockResolvedValue(0);
      configService.get!.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'ADMIN_EMAIL') return 'newadmin@intraflow.dev';
        if (key === 'ADMIN_PASSWORD') return 'SecurePassword123!';
        if (key === 'ADMIN_NAME') return 'Bootstrap Admin';
        return undefined;
      });

      await service.onApplicationBootstrap();

      expect(authService.hashPassword).toHaveBeenCalledWith('SecurePassword123!');
      expect(userRepo.create).toHaveBeenCalledWith({
        name: 'Bootstrap Admin',
        email: 'newadmin@intraflow.dev',
        password: 'v2.mocked_salt.mocked_hash',
        role: UserRole.ADMIN,
      });
      expect(userRepo.save).toHaveBeenCalled();
    });
  });
});
