import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { makeMockDB } from './helpers/mock-db.js';

describe('auth route gating', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Only Google enabled — Okta routes must not exist
    app = await buildTestApp(makeMockDB(), {
      AUTH_PROVIDERS: ['google'],
      GOOGLE_CLIENT_ID: 'g-id',
      GOOGLE_CLIENT_SECRET: 'g-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/auth/google/callback',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes /api/auth/config listing enabled providers', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ providers: ['google'] });
  });

  it('returns 404 for the disabled Okta provider route', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/auth/okta' });
    expect(r.statusCode).toBe(404);
  });

  it('returns 404 for the disabled Okta callback', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/auth/okta/callback' });
    expect(r.statusCode).toBe(404);
  });

  it('signout clears the session cookie even when none is set', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/signout' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
  });
});
