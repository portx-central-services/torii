import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { attachFakeUser, pmUser, viewerUser } from './helpers/auth-hook.js';
import type { DB } from '../src/db.js';
import type { AuthenticatedUser } from '../src/types.js';

function makeAllocationsDb() {
  return {
    allocation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    person: { findMany: vi.fn(), findUnique: vi.fn() },
  };
}

describe('allocations routes', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeAllocationsDb>;
  let userRef: { current: AuthenticatedUser | null };

  beforeEach(async () => {
    db = makeAllocationsDb();
    app = await buildTestApp(db as unknown as DB);
    userRef = attachFakeUser(app, null);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/allocations', () => {
    it('rejects Viewer with 403', async () => {
      userRef.current = viewerUser;
      const r = await app.inject({
        method: 'POST',
        url: '/api/allocations',
        payload: {
          projectId: 'p1',
          personId: 'person1',
          pct: 50,
          start: '2026-06-01',
          end: '2026-08-31',
        },
      });
      expect(r.statusCode).toBe(403);
      expect(db.allocation.create).not.toHaveBeenCalled();
    });

    it('creates a valid allocation for a PM', async () => {
      userRef.current = pmUser;
      db.allocation.findFirst.mockResolvedValue(null);
      db.allocation.create.mockResolvedValue({
        id: 'a1',
        projectId: 'p1',
        personId: 'person1',
        pct: 50,
        start: new Date('2026-06-01'),
        end: new Date('2026-08-31'),
      });
      const r = await app.inject({
        method: 'POST',
        url: '/api/allocations',
        payload: {
          projectId: 'p1',
          personId: 'person1',
          pct: 50,
          start: '2026-06-01',
          end: '2026-08-31',
        },
      });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ id: 'a1', start: '2026-06-01', end: '2026-08-31' });
    });

    it('returns 409 on overlap with an existing allocation for same person+project', async () => {
      userRef.current = pmUser;
      db.allocation.findFirst.mockResolvedValue({ id: 'existing' });
      const r = await app.inject({
        method: 'POST',
        url: '/api/allocations',
        payload: {
          projectId: 'p1',
          personId: 'person1',
          pct: 50,
          start: '2026-07-01',
          end: '2026-09-30',
        },
      });
      expect(r.statusCode).toBe(409);
      expect(db.allocation.create).not.toHaveBeenCalled();
    });

    it('rejects end < start', async () => {
      userRef.current = pmUser;
      const r = await app.inject({
        method: 'POST',
        url: '/api/allocations',
        payload: {
          projectId: 'p1',
          personId: 'person1',
          pct: 50,
          start: '2026-08-01',
          end: '2026-07-01',
        },
      });
      expect(r.statusCode).toBe(400);
    });

    it('rejects pct outside 0..100', async () => {
      userRef.current = pmUser;
      const r = await app.inject({
        method: 'POST',
        url: '/api/allocations',
        payload: {
          projectId: 'p1',
          personId: 'person1',
          pct: 150,
          start: '2026-06-01',
          end: '2026-08-31',
        },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/allocations/:id', () => {
    it('updates an allocation', async () => {
      userRef.current = pmUser;
      db.allocation.findUnique.mockResolvedValue({
        id: 'a1',
        projectId: 'p1',
        personId: 'person1',
        pct: 50,
        start: new Date('2026-06-01'),
        end: new Date('2026-08-31'),
      });
      db.allocation.findFirst.mockResolvedValue(null);
      db.allocation.update.mockResolvedValue({
        id: 'a1',
        projectId: 'p1',
        personId: 'person1',
        pct: 75,
        start: new Date('2026-06-01'),
        end: new Date('2026-08-31'),
      });
      const r = await app.inject({
        method: 'PATCH',
        url: '/api/allocations/a1',
        payload: { pct: 75 },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ pct: 75 });
    });

    it('returns 409 when new dates overlap another allocation', async () => {
      userRef.current = pmUser;
      db.allocation.findUnique.mockResolvedValue({
        id: 'a1',
        projectId: 'p1',
        personId: 'person1',
        pct: 50,
        start: new Date('2026-06-01'),
        end: new Date('2026-08-31'),
      });
      db.allocation.findFirst.mockResolvedValue({ id: 'a2' });
      const r = await app.inject({
        method: 'PATCH',
        url: '/api/allocations/a1',
        payload: { start: '2026-07-01', end: '2026-09-15' },
      });
      expect(r.statusCode).toBe(409);
    });
  });

  describe('DELETE /api/allocations/:id', () => {
    it('deletes an allocation', async () => {
      userRef.current = pmUser;
      db.allocation.findUnique.mockResolvedValue({ id: 'a1' });
      db.allocation.delete.mockResolvedValue({ id: 'a1' });
      const r = await app.inject({ method: 'DELETE', url: '/api/allocations/a1' });
      expect(r.statusCode).toBe(204);
      expect(db.allocation.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    });

    it('returns 404 when not found', async () => {
      userRef.current = pmUser;
      db.allocation.findUnique.mockResolvedValue(null);
      const r = await app.inject({ method: 'DELETE', url: '/api/allocations/missing' });
      expect(r.statusCode).toBe(404);
    });
  });

  describe('GET /api/people/:id/allocations', () => {
    it('returns allocations joined with project details', async () => {
      userRef.current = viewerUser;
      db.allocation.findMany.mockResolvedValue([
        {
          id: 'a1',
          projectId: 'p1',
          personId: 'person1',
          pct: 50,
          start: new Date('2026-06-01'),
          end: new Date('2026-08-31'),
          project: { name: 'Acme', phase: 'Build', state: 'OnTrack' },
        },
      ]);
      const r = await app.inject({
        method: 'GET',
        url: '/api/people/person1/allocations?from=2026-06-01&to=2026-09-30',
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual([
        {
          id: 'a1',
          projectId: 'p1',
          personId: 'person1',
          pct: 50,
          start: '2026-06-01',
          end: '2026-08-31',
          project: { name: 'Acme', phase: 'Build', state: 'OnTrack' },
        },
      ]);
      // Verify date-range overlap predicate
      const args = db.allocation.findMany.mock.calls[0]?.[0] as {
        where: { start: { lte: Date }; end: { gte: Date } };
      };
      expect(args.where.start.lte).toEqual(new Date('2026-09-30'));
      expect(args.where.end.gte).toEqual(new Date('2026-06-01'));
    });

    it('rejects when from/to are missing', async () => {
      userRef.current = viewerUser;
      const r = await app.inject({
        method: 'GET',
        url: '/api/people/person1/allocations',
      });
      expect(r.statusCode).toBe(400);
    });
  });
});
