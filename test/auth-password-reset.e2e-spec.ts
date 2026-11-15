import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createTestApp, closeTestApp, createAndSignInUser, TestAppBundle } from './test-helper';
import { User, UserRole } from '../src/users/entities/user.entity';
import { PasswordResetToken } from '../src/auth/entities/password-reset-token.entity';
import { AuthService } from '../src/auth/auth.service';
import { MailService, SentMail } from '../src/mail/mail.service';

describe('Password Reset Lifecycle (E2E intraflow_test)', () => {
  let bundle: TestAppBundle;
  let app: INestApplication<App>;
  let userRepo: Repository<User>;
  let resetTokenRepo: Repository<PasswordResetToken>;
  let authService: AuthService;
  let mailService: MailService;
  let ipCounter = 1;
  function getTestIp(): string {
    return `10.77.${Math.floor(ipCounter / 200)}.${(ipCounter++ % 200) + 1}`;
  }

  function extractToken(sentMail: SentMail | undefined): string {
    const match = sentMail?.html.match(/token=([0-9a-f]{64})/);
    return match ? match[1] : '';
  }

  beforeAll(async () => {
    bundle = await createTestApp();
    app = bundle.app;
    userRepo = bundle.moduleFixture.get(getRepositoryToken(User));
    resetTokenRepo = bundle.moduleFixture.get(getRepositoryToken(PasswordResetToken));
    authService = bundle.moduleFixture.get(AuthService);
    mailService = bundle.moduleFixture.get(MailService);
  });

  afterAll(async () => {
    await closeTestApp(bundle);
  });

  beforeEach(() => {
    mailService.clearMails();
  });

  it('forgot-password returns 202 and sends email with 32-byte hex token for existing user', async () => {
    await createAndSignInUser(app, userRepo, authService, 'alice.reset@intraflow.dev', UserRole.EMPLOYEE, 'Alice');

    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'ALICE.RESET@intraflow.dev ' }); // Tests normalization (trim and lowercase)

    expect(res.status).toBe(202);
    expect(res.body.message).toContain('If that email address is in our database');

    const sent = mailService.getLastMail();
    expect(sent).toBeDefined();
    expect(sent?.to).toBe('alice.reset@intraflow.dev');
    expect(sent?.subject).toBe('Password Reset Request');
    expect(sent?.html).toContain('/reset-password?token=');

    // Extract token from link
    const match = sent?.html.match(/token=([0-9a-f]{64})/);
    expect(match).toBeDefined();
    const token = match![1];
    expect(token.length).toBe(64); // 32 bytes in hex = 64 hex chars

    // Check that raw token is NOT in database, only SHA-256 hash
    const inDbRaw = await resetTokenRepo.findOneBy({ tokenHash: token });
    expect(inDbRaw).toBeNull();

    const allTokens = await resetTokenRepo.find();
    expect(allTokens.length).toBeGreaterThan(0);
    const validToken = allTokens.find((t) => t.usedAt === null);
    expect(validToken).toBeDefined();
    expect(validToken?.tokenHash).not.toBe(token);
  });

  it('forgot-password returns identical 202 and sends NO email for unknown email', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'nonexistent.user@intraflow.dev' });

    expect(res.status).toBe(202);
    expect(res.body.message).toContain('If that email address is in our database');
    expect(mailService.getSentMails().length).toBe(0);
  });

  it('forgot-password returns identical 202 and sends NO email for soft-deleted user', async () => {
    const softDel = await createAndSignInUser(
      app,
      userRepo,
      authService,
      'deleted.reset@intraflow.dev',
      UserRole.EMPLOYEE,
      'Deleted',
    );
    await userRepo.softDelete(softDel.user.userId);

    const res = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'deleted.reset@intraflow.dev' });

    expect(res.status).toBe(202);
    expect(res.body.message).toContain('If that email address is in our database');
    expect(mailService.getSentMails().length).toBe(0);
  });

  it('forgot-password invalidates previous active token when a new request is made', async () => {
    await createAndSignInUser(app, userRepo, authService, 'bob.multitoken@intraflow.dev', UserRole.EMPLOYEE, 'Bob');

    // First request
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'bob.multitoken@intraflow.dev' });
    const firstMail = mailService.getLastMail();
    const firstToken = extractToken(firstMail);

    // Second request
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'bob.multitoken@intraflow.dev' });
    const secondMail = mailService.getLastMail();
    const secondToken = extractToken(secondMail);

    expect(firstToken).not.toBe(secondToken);

    // First token must now fail (usedAt marked or invalidated)
    const failRes = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ token: firstToken, password: 'NewSecurePassword123!' });
    expect(failRes.status).toBe(400);
    expect(failRes.body.message).toContain('Invalid or expired token');

    // Second token must succeed
    const okRes = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ token: secondToken, password: 'NewSecurePassword123!' });
    expect(okRes.status).toBe(200);
  });

  it('reset-password successfully resets password, rejects weak password, and rejects token reuse', async () => {
    await createAndSignInUser(app, userRepo, authService, 'carol.reset@intraflow.dev', UserRole.EMPLOYEE, 'Carol');

    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'carol.reset@intraflow.dev' });

    const token = extractToken(mailService.getLastMail());

    // Weak password rejection (400)
    const weakRes = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ token, password: 'weak' });
    expect(weakRes.status).toBe(400);

    // Valid reset
    const successRes = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ token, password: 'SuperNewPassword123!' });
    expect(successRes.status).toBe(200);
    expect(successRes.body.message).toContain('Password has been reset');

    // Token reuse rejected (400)
    const reuseRes = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ token, password: 'AnotherNewPassword123!' });
    expect(reuseRes.status).toBe(400);
    expect(reuseRes.body.message).toContain('Invalid or expired token');

    // Verify sign in with new password succeeds and old password fails
    const oldLogin = await request(app.getHttpServer())
      .post('/auth/signin')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'carol.reset@intraflow.dev', password: 'Password123!' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app.getHttpServer())
      .post('/auth/signin')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'carol.reset@intraflow.dev', password: 'SuperNewPassword123!' });
    expect(newLogin.status).toBe(201);
  });

  it('reset-password rejects expired tokens with 400', async () => {
    await createAndSignInUser(app, userRepo, authService, 'expired.reset@intraflow.dev', UserRole.EMPLOYEE, 'Expired');

    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'expired.reset@intraflow.dev' });

    const token = extractToken(mailService.getLastMail());

    // Artificially expire the token in DB
    const allTokens = await resetTokenRepo.find({ order: { id: 'DESC' } });
    const target = allTokens[0];
    target.expiresAt = new Date(Date.now() - 60000); // 1 minute in the past
    await resetTokenRepo.save(target);

    const res = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ token, password: 'FreshSecurePassword123!' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Invalid or expired token');
  });

  it('concurrent double-use of reset token allows exactly one success', async () => {
    await createAndSignInUser(app, userRepo, authService, 'race.reset@intraflow.dev', UserRole.EMPLOYEE, 'Race');

    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'race.reset@intraflow.dev' });

    const token = extractToken(mailService.getLastMail());

    // Send two concurrent reset requests with the same token
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('X-Forwarded-For', getTestIp())
        .send({ token, password: 'ConcurrentPassOne123!' }),
      request(app.getHttpServer())
        .post('/auth/reset-password')
        .set('X-Forwarded-For', getTestIp())
        .send({ token, password: 'ConcurrentPassTwo123!' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 400]);
  });

  it('password reset invalidates existing sessions with 401', async () => {
    const userBundle = await createAndSignInUser(
      app,
      userRepo,
      authService,
      'session.kill@intraflow.dev',
      UserRole.EMPLOYEE,
      'SessionKill',
    );
    const existingCookies = userBundle.cookies;

    // Verify existing session currently works
    const check1 = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', existingCookies);
    expect(check1.status).toBe(200);

    // Request reset
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ email: 'session.kill@intraflow.dev' });

    const token = extractToken(mailService.getLastMail());

    // Reset password
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('X-Forwarded-For', getTestIp())
      .send({ token, password: 'RebootedPassword123!' });

    // Existing session must now be invalidated (401)
    const check2 = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', existingCookies);
    expect(check2.status).toBe(401);
  });
});
