import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app.factory.js';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createTestApp();
  });

  it('GET /v1/health returns ok', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('miniopenfx');
  });

  afterEach(async () => {
    await app.close();
  });
});
