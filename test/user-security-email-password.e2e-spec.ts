import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createTestApp, closeTestApp, createAndSignInUser, TestAppBundle } from './test-helper';
import { User, UserRole } from '../src/users/entities/user.entity';
import { EmailChangeRequest } from '../src/users/entities/email-change-request.entity';
import { AuthService } from '../src/auth/auth.service';
import { MailService, SentMail } from '../src/mail/mail.service';

describe('User Security - Password Change & Email Change (E2E intraflow_test)', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let emailChangeRepo: Repository<EmailChangeRequest>;
  let authService: AuthService;
  let mailService: MailService;
  let ipCounter = 1;
  function getTestIp(): string {
    return `10.88.${Math.floor(ipCounter / 200)}.${(ipCounter++ % 200) + 1}`;
  }

  function extractToken(sentMail: SentMail | undefined): string {
    const match = sentMail?.html.match(/token=([0-9a-f]{64})/);
    return match ? match[1] : '';
  }

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = bundle.moduleFixture.get(getRepositoryToken(User));
    emailChangeRepo = bundle.moduleFixture.get(getRepositoryToken(EmailChangeRequest));
    authService = bundle.moduleFixture.get(AuthService);
    mailService = bundle.moduleFixture.get(MailService);
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  beforeEach(() => {
    mailService.clearMails();
  });

  describe('1. PATCH /users/me/password', () => {
    it('rejects wrong current password with 401', async () => {
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'wrong.pass@intraflow.dev',
        UserRole.EMPLOYEE,
        'WrongPass',
      );

      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Cookie', userBundle.cookies)
        .send({
          currentPassword: 'IncorrectPassword123!',
          newPassword: 'BrandNewPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.message).toContain('Current password is incorrect');
    });

    it('rejects new password identical to current password with 400', async () => {
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'same.pass@intraflow.dev',
        UserRole.EMPLOYEE,
        'SamePass',
      );

      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Cookie', userBundle.cookies)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'Password123!',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('New password cannot be the same');
    });

    it('rejects weak new password with 400', async () => {
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'weak.pass@intraflow.dev',
        UserRole.EMPLOYEE,
        'WeakPass',
      );

      const res = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Cookie', userBundle.cookies)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'weak',
        });

      expect(res.status).toBe(400);
    });

    it('successfully changes password: keeps caller logged in while invalidating other sessions', async () => {
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'multi.client@intraflow.dev',
        UserRole.EMPLOYEE,
        'MultiClient',
      );
      const client1Cookies = userBundle.cookies;

      // Create client 2 session by signing in again
      const signin2 = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({
          email: 'multi.client@intraflow.dev',
          password: 'Password123!',
        });
      expect(signin2.status).toBe(201);
      const client2Cookies = signin2.headers['set-cookie'] as string[];

      // Client 1 changes password
      const changeRes = await request(app.getHttpServer())
        .patch('/users/me/password')
        .set('Cookie', client1Cookies)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'ChangedPassword123!',
        });
      expect(changeRes.status).toBe(200);

      // In cookie-session, updated session.iat is emitted via set-cookie
      const updatedClient1Cookies = (changeRes.headers['set-cookie'] as string[]) || client1Cookies;

      // Caller (Client 1) must remain logged in
      const callerCheck = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', updatedClient1Cookies);
      expect(callerCheck.status).toBe(200);

      // Other session (Client 2) must be invalidated (401)
      const otherCheck = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', client2Cookies);
      expect(otherCheck.status).toBe(401);
    });
  });

  describe('2. POST /users/me/email and POST /users/me/email/confirm', () => {
    it('request rejects wrong password with 401', async () => {
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'email.wrongpass@intraflow.dev',
        UserRole.EMPLOYEE,
        'EmailWrongPass',
      );

      const res = await request(app.getHttpServer())
        .post('/users/me/email')
        .set('X-Forwarded-For', getTestIp())
        .set('Cookie', userBundle.cookies)
        .send({
          currentPassword: 'WrongPassword123!',
          newEmail: 'newemail@intraflow.dev',
        });

      expect(res.status).toBe(401);
    });

    it('request rejects new email identical to current email with 400', async () => {
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'email.same@intraflow.dev',
        UserRole.EMPLOYEE,
        'EmailSame',
      );

      const res = await request(app.getHttpServer())
        .post('/users/me/email')
        .set('X-Forwarded-For', getTestIp())
        .set('Cookie', userBundle.cookies)
        .send({
          currentPassword: 'Password123!',
          newEmail: 'email.same@intraflow.dev',
        });

      expect(res.status).toBe(400);
    });

    it('request rejects new email already taken with 409', async () => {
      await createAndSignInUser(
        app,
        userRepo,
        authService,
        'existing.taken@intraflow.dev',
        UserRole.EMPLOYEE,
        'ExistingTaken',
      );
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'want.to.take@intraflow.dev',
        UserRole.EMPLOYEE,
        'WantToTake',
      );

      const res = await request(app.getHttpServer())
        .post('/users/me/email')
        .set('X-Forwarded-For', getTestIp())
        .set('Cookie', userBundle.cookies)
        .send({
          currentPassword: 'Password123!',
          newEmail: 'existing.taken@intraflow.dev',
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('Email address is already in use');
    });

    it('successful request stores token hash and sends verification email to new address', async () => {
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'start.email@intraflow.dev',
        UserRole.EMPLOYEE,
        'StartEmail',
      );

      const res = await request(app.getHttpServer())
        .post('/users/me/email')
        .set('X-Forwarded-For', getTestIp())
        .set('Cookie', userBundle.cookies)
        .send({
          currentPassword: 'Password123!',
          newEmail: 'target.email@intraflow.dev',
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('Verification email sent');

      const sentMail = mailService.getLastMail();
      expect(sentMail).toBeDefined();
      expect(sentMail?.to).toBe('target.email@intraflow.dev');
      expect(sentMail?.subject).toBe('Confirm your new email address');
      expect(sentMail?.html).toContain('/confirm-email?token=');

      // Verify token hash in DB
      const match = sentMail?.html.match(/token=([0-9a-f]{64})/);
      const token = match![1];
      const requestRow = await emailChangeRepo.findOneBy({ newEmail: 'target.email@intraflow.dev' });
      expect(requestRow).toBeDefined();
      expect(requestRow?.tokenHash).not.toBe(token);
    });

    it('concurrent email change requests ensure at most one active request exists in DB', async () => {
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'concurrent.email@intraflow.dev',
        UserRole.EMPLOYEE,
        'ConcurrentEmail',
      );

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post('/users/me/email')
          .set('X-Forwarded-For', getTestIp())
          .set('Cookie', userBundle.cookies)
          .send({
            currentPassword: 'Password123!',
            newEmail: 'target.concurrent1@intraflow.dev',
          }),
        request(app.getHttpServer())
          .post('/users/me/email')
          .set('X-Forwarded-For', getTestIp())
          .set('Cookie', userBundle.cookies)
          .send({
            currentPassword: 'Password123!',
            newEmail: 'target.concurrent2@intraflow.dev',
          }),
      ]);

      expect([res1.status, res2.status]).toContain(201);

      // Verify that at most one active request remains for this user
      const requests = await emailChangeRepo.find({
        where: { userId: userBundle.user.userId },
      });
      const activeRequests = requests.filter(
        (r) => !r.usedAt && new Date(r.expiresAt) > new Date(),
      );
      expect(activeRequests.length).toBe(1);
    });

    it('confirm rejects invalid, expired, and reused tokens with 400', async () => {
      // Invalid token
      const invalidRes = await request(app.getHttpServer())
        .post('/users/me/email/confirm')
        .send({ token: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' });
      expect(invalidRes.status).toBe(400);

      // Expired token
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'expire.me@intraflow.dev',
        UserRole.EMPLOYEE,
        'ExpireMe',
      );
      await request(app.getHttpServer())
        .post('/users/me/email')
        .set('X-Forwarded-For', getTestIp())
        .set('Cookie', userBundle.cookies)
        .send({
          currentPassword: 'Password123!',
          newEmail: 'expire.target@intraflow.dev',
        });

      const token = extractToken(mailService.getLastMail());
      const row = (await emailChangeRepo.findOneBy({ newEmail: 'expire.target@intraflow.dev' }))!;
      row.expiresAt = new Date(Date.now() - 60000);
      await emailChangeRepo.save(row);

      const expiredRes = await request(app.getHttpServer())
        .post('/users/me/email/confirm')
        .send({ token });
      expect(expiredRes.status).toBe(400);
    });

    it('confirm successfully updates user email, notifies old address, and invalidates old sessions', async () => {
      const userBundle = await createAndSignInUser(
        app,
        userRepo,
        authService,
        'old.account@intraflow.dev',
        UserRole.EMPLOYEE,
        'OldAccount',
      );
      const activeCookies = userBundle.cookies;

      await request(app.getHttpServer())
        .post('/users/me/email')
        .set('X-Forwarded-For', getTestIp())
        .set('Cookie', activeCookies)
        .send({
          currentPassword: 'Password123!',
          newEmail: 'new.confirmed@intraflow.dev',
        });

      const token = extractToken(mailService.getLastMail());
      mailService.clearMails();

      // Confirm the email change
      const confirmRes = await request(app.getHttpServer())
        .post('/users/me/email/confirm')
        .send({ token });
      expect(confirmRes.status).toBe(200);

      // Check user in DB
      const updatedUser = await userRepo.findOneBy({ userId: userBundle.user.userId });
      expect(updatedUser?.email).toBe('new.confirmed@intraflow.dev');

      // Check notification sent to OLD address
      const noticeMail = mailService.getLastMail();
      expect(noticeMail).toBeDefined();
      expect(noticeMail?.to).toBe('old.account@intraflow.dev');
      expect(noticeMail?.subject).toContain('email has been changed');

      // Token reuse fails
      const reuseRes = await request(app.getHttpServer())
        .post('/users/me/email/confirm')
        .send({ token });
      expect(reuseRes.status).toBe(400);

      // Old session invalidated (sessionsValidFrom updated)
      const sessionCheck = await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', activeCookies);
      expect(sessionCheck.status).toBe(401);

      // Signin with new email works
      const signinRes = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({
          email: 'new.confirmed@intraflow.dev',
          password: 'Password123!',
        });
      expect(signinRes.status).toBe(201);
    });

    it('race condition on two users confirming same email gives 409 for second user', async () => {
      const u1 = await createAndSignInUser(app, userRepo, authService, 'u1.race@intraflow.dev', UserRole.EMPLOYEE, 'U1');
      const u2 = await createAndSignInUser(app, userRepo, authService, 'u2.race@intraflow.dev', UserRole.EMPLOYEE, 'U2');

      // U1 requests email change to race.shared@intraflow.dev
      await request(app.getHttpServer())
        .post('/users/me/email')
        .set('X-Forwarded-For', getTestIp())
        .set('Cookie', u1.cookies)
        .send({ currentPassword: 'Password123!', newEmail: 'race.shared@intraflow.dev' });
      const t1 = extractToken(mailService.getLastMail());

      // Directly insert or request change for U2 to race.shared@intraflow.dev before U1 confirms
      await request(app.getHttpServer())
        .post('/users/me/email')
        .set('X-Forwarded-For', getTestIp())
        .set('Cookie', u2.cookies)
        .send({ currentPassword: 'Password123!', newEmail: 'race.shared@intraflow.dev' });
      const t2 = extractToken(mailService.getLastMail());

      // U1 confirms first -> 200
      const c1 = await request(app.getHttpServer())
        .post('/users/me/email/confirm')
        .send({ token: t1 });
      expect(c1.status).toBe(200);

      // U2 attempts to confirm second -> 409 Conflict
      const c2 = await request(app.getHttpServer())
        .post('/users/me/email/confirm')
        .send({ token: t2 });
      expect(c2.status).toBe(409);
      expect(c2.body.message).toContain('Email address is already in use');
    });
  });
});
