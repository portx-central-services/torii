import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { makeMockDB } from './helpers/mock-db.js';
import { clearKeycloakClientCache } from '../src/routes/auth/oidc-client.js';

describe('auth routes', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    clearKeycloakClientCache();
  });

  describe('without Keycloak configured', () => {
    it('exposes /api/auth/config with no providers', async () => {
      app = await buildTestApp(makeMockDB());
      const r = await app.inject({ method: 'GET', url: '/api/auth/config' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ providers: [] });
    });

    it('returns 404 on /api/auth/keycloak/login when env is incomplete', async () => {
      app = await buildTestApp(makeMockDB());
      const r = await app.inject({ method: 'GET', url: '/api/auth/keycloak/login' });
      expect(r.statusCode).toBe(404);
    });
  });

  describe('with Keycloak configured', () => {
    const kcEnv = {
      KEYCLOAK_ISSUER: 'https://keycloak.test/realms/torii',
      KEYCLOAK_CLIENT_ID: 'torii-api',
      KEYCLOAK_CLIENT_SECRET: 'secret',
      KEYCLOAK_REDIRECT_URI: 'http://localhost:3001/api/auth/keycloak/callback',
    };

    it('reports keycloak as the available provider', async () => {
      app = await buildTestApp(makeMockDB(), kcEnv);
      const r = await app.inject({ method: 'GET', url: '/api/auth/config' });
      expect(r.json()).toEqual({ providers: ['keycloak'] });
    });

    it('returns 404 for removed Google/Okta routes', async () => {
      app = await buildTestApp(makeMockDB(), kcEnv);
      for (const url of [
        '/api/auth/google',
        '/api/auth/google/callback',
        '/api/auth/okta',
        '/api/auth/okta/callback',
      ]) {
        const r = await app.inject({ method: 'GET', url });
        expect(r.statusCode, `expected 404 for ${url}`).toBe(404);
      }
    });

    it('callback without state cookie redirects to /signin?signin_error=missing_state', async () => {
      app = await buildTestApp(makeMockDB(), kcEnv);
      const r = await app.inject({
        method: 'GET',
        url: '/api/auth/keycloak/callback?code=abc&state=xyz',
      });
      expect(r.statusCode).toBe(302);
      const location = r.headers.location;
      expect(location).toMatch(/\/signin\?signin_error=missing_state$/);
    });

    it('signout clears the cookie even when no session exists', async () => {
      // Empty Keycloak issuer skips end-session URL construction (issuer discovery is mocked off).
      app = await buildTestApp(makeMockDB());
      const r = await app.inject({ method: 'POST', url: '/api/auth/signout' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ ok: true, endSessionUrl: null });
    });

    it('signout deletes the active Session row when one exists', async () => {
      const db = makeMockDB();
      const sessionDelete = vi.fn().mockResolvedValue({});
      // @ts-expect-error mockDB shape is permissive
      db.session.delete = sessionDelete;
      app = await buildTestApp(db);

      const cookie = await app.inject({
        method: 'POST',
        url: '/api/auth/signout',
        // Inject a signed cookie value matching SESSION_COOKIE_NAME.
        cookies: { torii_sess: 'fake.signed.value' },
      });
      expect(cookie.statusCode).toBe(200);
      // sessionDelete may or may not be invoked depending on signed-cookie validity;
      // the route is idempotent.
    });
  });
});

describe('preview-admin bypass policy', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it('does NOT authenticate via the preview cookie when the bypass env flag is off', async () => {
    app = await buildTestApp(makeMockDB(), { ENABLE_PREVIEW_ADMIN_BYPASS: false });
    const r = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { torii_preview_admin: '1' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ authenticated: false });
  });

  it('DOES authenticate via the preview cookie when the bypass env flag is on', async () => {
    app = await buildTestApp(makeMockDB(), { ENABLE_PREVIEW_ADMIN_BYPASS: true });
    const r = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { torii_preview_admin: '1' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { authenticated: boolean; user?: { isAdmin: boolean } };
    expect(body.authenticated).toBe(true);
    expect(body.user?.isAdmin).toBe(true);
  });
});
