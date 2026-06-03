import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { attachFakeUser, pmUser, viewerUser } from './helpers/auth-hook.js';
import type { DB } from '../src/db.js';
import type { AuthenticatedUser } from '../src/types.js';

const adminUser: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@portx.io',
  name: 'Admin One',
  role: 'PM',
  isAdmin: true,
};

const targetPersonId = 'aaron';

function basePerson() {
  return {
    id: targetPersonId,
    name: 'Aaron',
    email: 'aaron@portx.io',
    role: 'Viewer',
    defaultCapacityPct: 100,
    isAdmin: false,
    harvestUserId: null as string | null,
    availabilityPct: 30,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeDb() {
  const person = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const personProjectCapacity = {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  };
  const allocation = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const harvestProject = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const tx = { person, personProjectCapacity };
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
  return { person, personProjectCapacity, allocation, harvestProject, $transaction };
}

describe('workload routes', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeDb>;
  let userRef: { current: AuthenticatedUser | null };

  beforeEach(async () => {
    db = makeDb();
    app = await buildTestApp(db as unknown as DB);
    userRef = attachFakeUser(app, null);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/people/:id/workload', () => {
    it('returns 401 when unauthenticated', async () => {
      userRef.current = null;
      const r = await app.inject({ method: 'GET', url: `/api/people/${targetPersonId}/workload` });
      expect(r.statusCode).toBe(401);
    });

    it('returns 404 when person not found', async () => {
      userRef.current = viewerUser;
      db.person.findUnique.mockResolvedValue(null);
      const r = await app.inject({ method: 'GET', url: `/api/people/${targetPersonId}/workload` });
      expect(r.statusCode).toBe(404);
    });

    it('returns the union of active allocations and self-reported capacity rows', async () => {
      userRef.current = viewerUser;
      db.person.findUnique.mockResolvedValue(basePerson());
      db.personProjectCapacity.findMany.mockResolvedValue([
        {
          personId: targetPersonId,
          projectId: 'proj-A',
          weeklyPct: 40,
          project: {
            id: 'proj-A',
            name: 'Self-only project',
            phase: 'Development',
            state: 'OnTrack',
          },
          updatedAt: new Date('2026-06-01T00:00:00Z'),
        },
      ]);
      db.allocation.findMany.mockResolvedValue([
        {
          personId: targetPersonId,
          projectId: 'proj-B',
          pct: 50,
          start: new Date('2026-01-01'),
          end: new Date('2026-12-31'),
          project: {
            id: 'proj-B',
            name: 'Allocation-only project',
            phase: 'UAT',
            state: 'OnTrack',
          },
        },
      ]);

      const r = await app.inject({ method: 'GET', url: `/api/people/${targetPersonId}/workload` });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { projects: Array<{ projectId: string; weeklyPct: number; allocatedPct: number }> };
      expect(body.projects).toHaveLength(2);
      const a = body.projects.find((p) => p.projectId === 'proj-A')!;
      const b = body.projects.find((p) => p.projectId === 'proj-B')!;
      expect(a.weeklyPct).toBe(40);
      expect(a.allocatedPct).toBe(0);
      expect(b.weeklyPct).toBe(0);
      expect(b.allocatedPct).toBe(50);
    });

    it('merges allocation and capacity when both exist for the same project', async () => {
      userRef.current = viewerUser;
      db.person.findUnique.mockResolvedValue(basePerson());
      db.personProjectCapacity.findMany.mockResolvedValue([
        {
          personId: targetPersonId,
          projectId: 'proj-X',
          weeklyPct: 80,
          project: { id: 'proj-X', name: 'Both', phase: 'Development', state: 'OnTrack' },
          updatedAt: new Date('2026-06-01T00:00:00Z'),
        },
      ]);
      db.allocation.findMany.mockResolvedValue([
        {
          personId: targetPersonId,
          projectId: 'proj-X',
          pct: 50,
          start: new Date('2026-01-01'),
          end: new Date('2026-12-31'),
          project: { id: 'proj-X', name: 'Both', phase: 'Development', state: 'OnTrack' },
        },
      ]);

      const r = await app.inject({ method: 'GET', url: `/api/people/${targetPersonId}/workload` });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { projects: Array<{ projectId: string; weeklyPct: number; allocatedPct: number }> };
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0]).toMatchObject({ projectId: 'proj-X', weeklyPct: 80, allocatedPct: 50 });
    });

    it('reports lifetimeHours as null when person is not Harvest-linked', async () => {
      userRef.current = viewerUser;
      db.person.findUnique.mockResolvedValue({ ...basePerson(), harvestUserId: null });
      db.personProjectCapacity.findMany.mockResolvedValue([
        {
          personId: targetPersonId,
          projectId: 'proj-A',
          weeklyPct: 40,
          project: { id: 'proj-A', name: 'A', phase: 'Development', state: 'OnTrack' },
          updatedAt: new Date('2026-06-01T00:00:00Z'),
        },
      ]);

      const r = await app.inject({ method: 'GET', url: `/api/people/${targetPersonId}/workload` });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { projects: Array<{ lifetimeHours: number | null; varianceBucket: string }> };
      expect(body.projects[0]!.lifetimeHours).toBeNull();
      expect(body.projects[0]!.varianceBucket).toBe('neutral');
    });
  });

  describe('PATCH /api/people/:id/workload', () => {
    it('returns 403 when a non-admin tries to edit someone else', async () => {
      userRef.current = pmUser;
      db.person.findUnique.mockResolvedValue(basePerson());
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/people/${targetPersonId}/workload`,
        payload: { availabilityPct: 50 },
      });
      expect(r.statusCode).toBe(403);
      expect(db.person.update).not.toHaveBeenCalled();
    });

    it('allows self-edit', async () => {
      const aaronSelf: AuthenticatedUser = {
        id: targetPersonId,
        email: 'aaron@portx.io',
        name: 'Aaron',
        role: 'Viewer',
        isAdmin: false,
      };
      userRef.current = aaronSelf;
      db.person.findUnique.mockResolvedValue(basePerson());
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/people/${targetPersonId}/workload`,
        payload: { availabilityPct: 50 },
      });
      expect(r.statusCode).toBe(200);
      expect(db.person.update).toHaveBeenCalledWith({
        where: { id: targetPersonId },
        data: { availabilityPct: 50 },
      });
    });

    it('allows admin-edit of someone else', async () => {
      userRef.current = adminUser;
      db.person.findUnique.mockResolvedValue(basePerson());
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/people/${targetPersonId}/workload`,
        payload: { availabilityPct: 20 },
      });
      expect(r.statusCode).toBe(200);
      expect(db.person.update).toHaveBeenCalledWith({
        where: { id: targetPersonId },
        data: { availabilityPct: 20 },
      });
    });

    it('rejects out-of-range weeklyPct', async () => {
      userRef.current = adminUser;
      db.person.findUnique.mockResolvedValue(basePerson());
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/people/${targetPersonId}/workload`,
        payload: { projects: [{ projectId: 'proj-A', weeklyPct: 150 }] },
      });
      expect(r.statusCode).toBe(400);
      expect(db.personProjectCapacity.upsert).not.toHaveBeenCalled();
    });

    it('deletes the row when weeklyPct is 0 (delete-on-zero)', async () => {
      userRef.current = adminUser;
      db.person.findUnique.mockResolvedValue(basePerson());
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/people/${targetPersonId}/workload`,
        payload: { projects: [{ projectId: 'proj-A', weeklyPct: 0 }] },
      });
      expect(r.statusCode).toBe(200);
      expect(db.personProjectCapacity.deleteMany).toHaveBeenCalledWith({
        where: { personId: targetPersonId, projectId: 'proj-A' },
      });
      expect(db.personProjectCapacity.upsert).not.toHaveBeenCalled();
    });

    it('upserts the row when weeklyPct > 0', async () => {
      userRef.current = adminUser;
      db.person.findUnique.mockResolvedValue(basePerson());
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/people/${targetPersonId}/workload`,
        payload: { projects: [{ projectId: 'proj-A', weeklyPct: 35 }] },
      });
      expect(r.statusCode).toBe(200);
      expect(db.personProjectCapacity.upsert).toHaveBeenCalledWith({
        where: { personId_projectId: { personId: targetPersonId, projectId: 'proj-A' } },
        update: { weeklyPct: 35 },
        create: { personId: targetPersonId, projectId: 'proj-A', weeklyPct: 35 },
      });
    });
  });
});
