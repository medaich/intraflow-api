import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import helmet from 'helmet';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';

describe('Application End-to-End Tests (Real Database, CORS & Helmet)', () => {
  let moduleFixture: TestingModule;
  let app: INestApplication<App>;
  let configService: ConfigService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configService = moduleFixture.get(ConfigService);

    // Mirroring production pipeline configuration from main.ts
    app.use(helmet());
    const corsOrigin = configService.get<string>('CORS_ORIGIN');
    app.enableCors({
      origin: corsOrigin ? [corsOrigin] : false,
      credentials: true,
    });

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      try {
        const ds = moduleFixture.get<DataSource>(DataSource);
        if (ds?.isInitialized) {
          await ds.destroy();
        }
      } catch {
        // DataSource already closed
      }
      await app.close();
    }
  });

  it('/health (GET) - verifies system and database connectivity', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info?.database?.status).toBe('up');
  });

  describe('CORS Configuration Tests', () => {
    it('returns Access-Control headers when requested from configured CORS_ORIGIN', async () => {
      const allowedOrigin = configService.get<string>('CORS_ORIGIN') ?? 'http://localhost:5173';
      const res = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', allowedOrigin);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(allowedOrigin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('omits Access-Control-Allow-Origin header when requested from unauthorized origin', async () => {
      const res = await request(app.getHttpServer())
        .get('/health')
        .set('Origin', 'http://unauthorized-attacker.example.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Helmet Security Headers Tests', () => {
    it('sets hardened HTTP security headers via helmet middleware', async () => {
      const res = await request(app.getHttpServer()).get('/health');
      expect(res.status).toBe(200);
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});
