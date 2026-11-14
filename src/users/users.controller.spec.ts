import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { AuthGuard } from '../guards/auth.guard';
import { AdminGuard } from '../guards/admin-auth.guard';

describe('UsersController (Route Ordering & Dispatch)', () => {
  let app: INestApplication<App>;
  const mockUsersService = {
    findOne: jest.fn().mockImplementation(({ userId }: { userId: number }) => {
      return Promise.resolve(new User({ userId, name: 'Target User' }));
    }),
    findAll: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    invite: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /users/me correctly reaches me handler instead of being shadowed by :userId', async () => {
    const res = await request(app.getHttpServer()).get('/users/me');
    expect(res.status).toBe(200);
  });
});
