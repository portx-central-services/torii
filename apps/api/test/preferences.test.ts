import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { attachFakeUser, pmUser, viewerUser } from './helpers/auth-hook.js';
import type { DB } from '../src/db.js';
import type { AuthenticatedUser } from '../src/types.js';

function makeDbInner() {
  const userPreference = {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  };
  return { userPreference };
}

describe('preferences routes', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeDbInner>;
  let userRef: { current: AuthenticatedUser | null };

  beforeEach(async () => {
    db = makeDbInner();
    app = await buildTestApp(db as unknown as DB);
    userRef = attachFakeUser(app, null);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/me/preferences', () => {
    it('returns 401 when unauthenticated', async () => {
      userRef.current = null;
      const r = await app.inject({ method: 'GET', url: '/api/me/preferences' });
      expect(r.statusCode).toBe(401);
    });

    it('defaults to empty hiddenProjectColumns when no row exists', async () => {
      userRef.current = viewerUser;
      db.userPreference.findUnique.mockResolvedValue(null);
      const r = await app.inject({ method: 'GET', url: '/api/me/preferences' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ hiddenProjectColumns: [] });
    });

    it('returns the stored hidden columns for the caller', async () => {
      userRef.current = pmUser;
      db.userPreference.findUnique.mockResolvedValue({
        data: { hiddenProjectColumns: ['solution_consultant'] },
      });
      const r = await app.inject({ method: 'GET', url: '/api/me/preferences' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ hiddenProjectColumns: ['solution_consultant'] });
      expect(db.userPreference.findUnique).toHaveBeenCalledWith({
        where: { personId: pmUser.id },
      });
    });
  });

  describe('PUT /api/me/preferences', () => {
    it('upserts and echoes the hidden columns', async () => {
      userRef.current = pmUser;
      db.userPreference.upsert.mockResolvedValue({});
      const r = await app.inject({
        method: 'PUT',
        url: '/api/me/preferences',
        payload: { hiddenProjectColumns: ['use_case_group', 'finance_use_case'] },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({
        hiddenProjectColumns: ['use_case_group', 'finance_use_case'],
      });
      const upsertArg = db.userPreference.upsert.mock.calls[0]?.[0] as {
        where: { personId: string };
        create: { personId: string; data: unknown };
      };
      expect(upsertArg.where).toEqual({ personId: pmUser.id });
      expect(upsertArg.create.data).toEqual({
        hiddenProjectColumns: ['use_case_group', 'finance_use_case'],
      });
    });

    it('rejects an unknown column id', async () => {
      userRef.current = pmUser;
      const r = await app.inject({
        method: 'PUT',
        url: '/api/me/preferences',
        payload: { hiddenProjectColumns: ['name', 'not_a_column'] },
      });
      expect(r.statusCode).toBe(400);
      expect(db.userPreference.upsert).not.toHaveBeenCalled();
    });

    it('returns 401 when unauthenticated', async () => {
      userRef.current = null;
      const r = await app.inject({
        method: 'PUT',
        url: '/api/me/preferences',
        payload: { hiddenProjectColumns: [] },
      });
      expect(r.statusCode).toBe(401);
    });
  });
});
