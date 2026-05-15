import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { makeMockDB } from './helpers/mock-db.js';

describe('api smoke', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(makeMockDB());
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz returns 200 with status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/me without a session returns authenticated:false', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
  });
});
