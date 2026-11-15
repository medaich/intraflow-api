import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieSession from 'cookie-session';
import { Express } from 'express';
import { App } from 'supertest/types';
import request from 'supertest';
import { Repository, DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { User, UserRole } from '../src/users/entities/user.entity';
import { AuthService } from '../src/auth/auth.service';
import { hashPassword } from '../src/auth/password-hasher';

export interface TestAppBundle {
  app: INestApplication<App>;
  moduleFixture: TestingModule;
}

export async function createTestApp(): Promise<TestAppBundle> {
  process.env.NODE_ENV = 'test';
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_GUARD)
    .useValue({ canActivate: () => true })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleFixture.createNestApplication();
  const configService = moduleFixture.get(ConfigService);

  const expressApp = app.getHttpAdapter().getInstance() as Express;
  const trustProxy = configService.get<number>('TRUST_PROXY', 1);
  expressApp.set('trust proxy', trustProxy);

  app.use(
    cookieSession({
      name: 'session',
      keys: [configService.getOrThrow<string>('COOKIE_KEY')],
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: configService.get<boolean>('COOKIE_SECURE') ?? false,
      sameSite: 'lax',
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.init();
  return { app, moduleFixture };
}

export async function closeTestApp(bundle: TestAppBundle): Promise<void> {
  if (bundle?.app) {
    try {
      const dataSource = bundle.moduleFixture.get<DataSource>(DataSource);
      if (dataSource?.isInitialized) {
        await dataSource.destroy();
      }
    } catch {
      // ignore if dataSource already destroyed or not found
    }
    await bundle.app.close();
  }
}

export async function createAndSignInUser(
  app: INestApplication<App>,
  userRepo: Repository<User>,
  authServiceOrEmail: AuthService | string,
  emailOrRole?: string | UserRole,
  roleOrName?: UserRole | string,
  possibleName?: string,
): Promise<{ user: User; cookies: string[] }> {
  let email: string;
  let role: UserRole = UserRole.EMPLOYEE;
  let name = 'Test User';

  if (typeof authServiceOrEmail === 'string') {
    email = authServiceOrEmail;
    if ((emailOrRole as UserRole) === UserRole.ADMIN || (emailOrRole as UserRole) === UserRole.EMPLOYEE) {
      role = emailOrRole as UserRole;
    }
    if (typeof roleOrName === 'string') {
      name = roleOrName;
    }
  } else {
    email = emailOrRole as string;
    if ((roleOrName as UserRole) === UserRole.ADMIN || (roleOrName as UserRole) === UserRole.EMPLOYEE) {
      role = roleOrName as UserRole;
    }
    if (possibleName) {
      name = possibleName;
    }
  }

  const isAdmin =
    email.toLowerCase() ===
    (process.env.ADMIN_EMAIL ?? 'admin@intraflow.dev').toLowerCase();
  const password = isAdmin
    ? (process.env.ADMIN_PASSWORD ?? 'AdminPassword123!')
    : 'Password123!';

  const existing = await userRepo.findOne({ where: { email: email.toLowerCase() } });
  let user: User;
  if (!existing) {
    const hashedPassword = await hashPassword(password);
    const created = userRepo.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
    });
    user = await userRepo.save(created);
  } else {
    if (existing.role !== role) {
      existing.role = role;
      await userRepo.save(existing);
    }
    user = existing;
  }

  // Real HTTP authentication via POST /auth/signin
  const userIp = `10.99.${user.userId % 250}.${Math.floor(Math.random() * 200) + 1}`;
  const signinRes = await request(app.getHttpServer())
    .post('/auth/signin')
    .set('X-Forwarded-For', userIp)
    .send({ email: email.toLowerCase(), password });

  if (signinRes.status !== 200 && signinRes.status !== 201) {
    throw new Error(
      `Failed to sign in user ${email}: HTTP ${signinRes.status} - ${JSON.stringify(signinRes.body)}`,
    );
  }

  const rawCookies = signinRes.get('Set-Cookie');
  const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
  return { user, cookies };
}
