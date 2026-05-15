import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { attachFakeUser, viewerUser } from './helpers/auth-hook.js';
import type { DB } from '../src/db.js';
import type { AuthenticatedUser } from '../src/types.js';

function makeDb() {
  return {
    allocation: { findMany: vi.fn() },
  };
}

describe('GET /api/capacity/rollup', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeDb>;
  let userRef: { current: AuthenticatedUser | null };

  beforeEach(async () => {
    db = makeDb();
    app = await buildTestApp(db as unknown as DB);
    userRef = attachFakeUser(app, null);
    userRef.current = viewerUser;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 when not authenticated', async () => {
    userRef.current = null;
    const r = await app.inject({
      method: 'GET',
      url: '/api/capacity/rollup?from=2026-06-01&to=2026-06-28',
    });
    expect(r.statusCode).toBe(401);
  });

  it('returns 4 weekly buckets for a 4-week window with no allocations', async () => {
    db.allocation.findMany.mockResolvedValue([]);
    const r = await app.inject({
      method: 'GET',
      url: '/api/capacity/rollup?from=2026-06-01&to=2026-06-28',
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { weeks: Array<{ weekStart: string }> };
    expect(body.weeks).toHaveLength(4);
    expect(body.weeks.map((w) => w.weekStart)).toEqual([
      '2026-06-01',
      '2026-06-08',
      '2026-06-15',
      '2026-06-22',
    ]);
  });

  it('sums two allocations on one person into a single weekly committed total', async () => {
    db.allocation.findMany.mockResolvedValue([
      {
        id: 'a1',
        projectId: 'p1',
        personId: 'person1',
        pct: 40,
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-06-30T00:00:00Z'),
        project: { id: 'p1', name: 'Acme' },
        person: { id: 'person1', name: 'Alice', defaultCapacityPct: 100 },
      },
      {
        id: 'a2',
        projectId: 'p2',
        personId: 'person1',
        pct: 30,
        start: new Date('2026-06-01T00:00:00Z'),
        end: new Date('2026-06-30T00:00:00Z'),
        project: { id: 'p2', name: 'Beta' },
        person: { id: 'person1', name: 'Alice', defaultCapacityPct: 100 },
      },
    ]);
    const r = await app.inject({
      method: 'GET',
      url: '/api/capacity/rollup?from=2026-06-01&to=2026-06-07',
    });
    const body = r.json() as {
      weeks: Array<{
        people: Array<{ personId: string; committedPct: number; overAllocated: boolean }>;
        projects: Array<{ projectId: string; demandPct: number }>;
      }>;
    };
    expect(body.weeks).toHaveLength(1);
    expect(body.weeks[0]!.people).toEqual([
      {
        personId: 'person1',
        personName: 'Alice',
        committedPct: 70,
        defaultCapacityPct: 100,
        overAllocated: false,
      },
    ]);
    expect(body.weeks[0]!.projects.map((p) => p.projectId).sort()).toEqual(['p1', 'p2']);
  });

  it('flags over_allocated when committed pct exceeds default capacity', async () => {
    db.allocation.findMany.mockResolvedValue([
      {
        id: 'a1',
        projectId: 'p1',
        personId: 'person1',
        pct: 80,
        start: new Date('2026-07-06T00:00:00Z'),
        end: new Date('2026-07-12T00:00:00Z'),
        project: { id: 'p1', name: 'Acme' },
        person: { id: 'person1', name: 'Alice', defaultCapacityPct: 100 },
      },
      {
        id: 'a2',
        projectId: 'p2',
        personId: 'person1',
        pct: 40,
        start: new Date('2026-07-06T00:00:00Z'),
        end: new Date('2026-07-12T00:00:00Z'),
        project: { id: 'p2', name: 'Beta' },
        person: { id: 'person1', name: 'Alice', defaultCapacityPct: 100 },
      },
    ]);
    const r = await app.inject({
      method: 'GET',
      url: '/api/capacity/rollup?from=2026-07-06&to=2026-07-12',
    });
    const body = r.json() as {
      weeks: Array<{ people: Array<{ committedPct: number; overAllocated: boolean }> }>;
    };
    expect(body.weeks[0]!.people[0]).toMatchObject({
      committedPct: 120,
      overAllocated: true,
    });
  });

  it('does NOT flag over_allocated at the exact capacity boundary', async () => {
    db.allocation.findMany.mockResolvedValue([
      {
        id: 'a1',
        projectId: 'p1',
        personId: 'person1',
        pct: 100,
        start: new Date('2026-07-06T00:00:00Z'),
        end: new Date('2026-07-12T00:00:00Z'),
        project: { id: 'p1', name: 'Acme' },
        person: { id: 'person1', name: 'Alice', defaultCapacityPct: 100 },
      },
    ]);
    const r = await app.inject({
      method: 'GET',
      url: '/api/capacity/rollup?from=2026-07-06&to=2026-07-12',
    });
    const body = r.json() as {
      weeks: Array<{ people: Array<{ committedPct: number; overAllocated: boolean }> }>;
    };
    expect(body.weeks[0]!.people[0]).toMatchObject({
      committedPct: 100,
      overAllocated: false,
    });
  });

  it('rejects to < from', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/capacity/rollup?from=2026-07-12&to=2026-07-06',
    });
    expect(r.statusCode).toBe(400);
  });
});
