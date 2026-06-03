import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { attachFakeUser, viewerUser } from './helpers/auth-hook.js';
import type { DB } from '../src/db.js';
import type { AuthenticatedUser } from '../src/types.js';

function person(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'aaron',
    name: 'Aaron',
    email: 'aaron@portx.io',
    role: 'Viewer',
    defaultCapacityPct: 100,
    isAdmin: false,
    harvestUserId: null as string | null,
    availabilityPct: 0,
    billedHoursLast30d: null,
    billedHoursAsOf: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDb() {
  const personModel = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const personProjectCapacity = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const allocation = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const harvestProject = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  const project = {
    findMany: vi.fn().mockResolvedValue([]),
  };
  return { person: personModel, personProjectCapacity, allocation, harvestProject, project };
}

describe('people overview routes', () => {
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

  it('returns 401 when unauthenticated', async () => {
    userRef.current = null;
    const r = await app.inject({ method: 'GET', url: '/api/people/overview' });
    expect(r.statusCode).toBe(401);
  });

  it('returns one row per Person', async () => {
    userRef.current = viewerUser;
    db.person.findMany.mockResolvedValue([
      person({ id: 'aaron', name: 'Aaron' }),
      person({ id: 'beth', name: 'Beth', email: 'beth@portx.io' }),
    ]);
    const r = await app.inject({ method: 'GET', url: '/api/people/overview' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as Array<{ id: string }>;
    expect(body).toHaveLength(2);
    expect(body.map((x) => x.id).sort()).toEqual(['aaron', 'beth']);
  });

  it('sums committedPct across capacity rows', async () => {
    userRef.current = viewerUser;
    db.person.findMany.mockResolvedValue([person({ id: 'aaron' })]);
    db.personProjectCapacity.findMany.mockResolvedValue([
      {
        personId: 'aaron',
        projectId: 'proj-A',
        weeklyPct: 40,
        project: { id: 'proj-A', name: 'A', phase: 'Development', state: 'OnTrack' },
        updatedAt: new Date('2026-06-01T00:00:00Z'),
      },
      {
        personId: 'aaron',
        projectId: 'proj-B',
        weeklyPct: 30,
        project: { id: 'proj-B', name: 'B', phase: 'UAT', state: 'OnTrack' },
        updatedAt: new Date('2026-06-02T00:00:00Z'),
      },
    ]);
    const r = await app.inject({ method: 'GET', url: '/api/people/overview' });
    const body = r.json() as Array<{ committedPct: number }>;
    expect(body[0]!.committedPct).toBe(70);
  });

  it('builds currentProjects as a union of allocations and capacity rows', async () => {
    userRef.current = viewerUser;
    db.person.findMany.mockResolvedValue([person({ id: 'aaron' })]);
    db.personProjectCapacity.findMany.mockResolvedValue([
      {
        personId: 'aaron',
        projectId: 'proj-A',
        weeklyPct: 30,
        project: { id: 'proj-A', name: 'Self-only', phase: 'Development', state: 'OnTrack' },
        updatedAt: new Date('2026-06-01T00:00:00Z'),
      },
    ]);
    // First findMany call = active allocations, second = all allocations.
    db.allocation.findMany
      .mockResolvedValueOnce([
        {
          personId: 'aaron',
          projectId: 'proj-B',
          pct: 50,
          start: new Date('2026-01-01'),
          end: new Date('2026-12-31'),
          project: { id: 'proj-B', name: 'Alloc-only', phase: 'UAT', state: 'OnTrack' },
        },
      ])
      .mockResolvedValueOnce([]);
    const r = await app.inject({ method: 'GET', url: '/api/people/overview' });
    const body = r.json() as Array<{
      currentProjects: Array<{ projectId: string; weeklyPct: number; allocatedPct: number }>;
    }>;
    const proj = body[0]!.currentProjects;
    expect(proj).toHaveLength(2);
    const a = proj.find((p) => p.projectId === 'proj-A')!;
    const b = proj.find((p) => p.projectId === 'proj-B')!;
    expect(a).toMatchObject({ weeklyPct: 30, allocatedPct: 0 });
    expect(b).toMatchObject({ weeklyPct: 0, allocatedPct: 50 });
  });

  it('reports billedHoursLast30d as null when Person is unlinked', async () => {
    userRef.current = viewerUser;
    db.person.findMany.mockResolvedValue([
      person({ id: 'aaron', harvestUserId: null, billedHoursLast30d: null }),
    ]);
    const r = await app.inject({ method: 'GET', url: '/api/people/overview' });
    const body = r.json() as Array<{ billedHoursLast30d: number | null }>;
    expect(body[0]!.billedHoursLast30d).toBeNull();
  });

  it('lastReportedAt is the latest capacity row update; null when no rows', async () => {
    userRef.current = viewerUser;
    db.person.findMany.mockResolvedValue([person({ id: 'aaron' }), person({ id: 'beth', email: 'beth@portx.io' })]);
    db.personProjectCapacity.findMany.mockResolvedValue([
      {
        personId: 'aaron',
        projectId: 'proj-A',
        weeklyPct: 20,
        project: { id: 'proj-A', name: 'A', phase: 'Development', state: 'OnTrack' },
        updatedAt: new Date('2026-06-10T00:00:00Z'),
      },
      {
        personId: 'aaron',
        projectId: 'proj-B',
        weeklyPct: 10,
        project: { id: 'proj-B', name: 'B', phase: 'UAT', state: 'OnTrack' },
        updatedAt: new Date('2026-06-15T00:00:00Z'),
      },
    ]);
    const r = await app.inject({ method: 'GET', url: '/api/people/overview' });
    const body = r.json() as Array<{ id: string; lastReportedAt: string | null }>;
    const aaron = body.find((p) => p.id === 'aaron')!;
    const beth = body.find((p) => p.id === 'beth')!;
    expect(aaron.lastReportedAt).toBe('2026-06-15T00:00:00.000Z');
    expect(beth.lastReportedAt).toBeNull();
  });
});
