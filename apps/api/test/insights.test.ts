import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { attachFakeUser, pmUser, viewerUser } from './helpers/auth-hook.js';
import type { DB } from '../src/db.js';
import type { AuthenticatedUser } from '../src/types.js';
import { isoWeekMondayUTC } from '../src/lib/iso-week.js';

function makeDb() {
  return {
    project: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    person: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    personProjectCapacity: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    customer: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    harvestProject: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $queryRaw: vi.fn(),
  };
}

describe('insights overview', () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof makeDb>;
  let userRef: { current: AuthenticatedUser | null };

  beforeEach(async () => {
    db = makeDb();
    // Default $queryRaw → empty rows (overview makes two raw queries).
    db.$queryRaw.mockResolvedValue([]);
    app = await buildTestApp(db as unknown as DB);
    userRef = attachFakeUser(app, null);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 when unauthenticated', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/insights/overview' });
    expect(r.statusCode).toBe(401);
  });

  it('returns 403 for a Viewer', async () => {
    userRef.current = viewerUser;
    const r = await app.inject({ method: 'GET', url: '/api/insights/overview' });
    expect(r.statusCode).toBe(403);
  });

  it('returns the InsightsOverview shape for a PM', async () => {
    userRef.current = pmUser;
    const r = await app.inject({ method: 'GET', url: '/api/insights/overview' });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.payload);
    expect(body).toHaveProperty('asOf');
    expect(body.kpis).toMatchObject({
      activeProjects: 0,
      atRisk: 0,
      recoveredThisWeek: 0,
      overBudget: 0,
      launchingSoon: 0,
      hours7d: 0,
      hours30d: 0,
      activeCustomers: 0,
    });
    expect(body.projects).toEqual([]);
    expect(body.people).toEqual([]);
    expect(body.trends.weeklyHours).toHaveLength(8);
    expect(body.trends.weeklyRag).toHaveLength(8);
  });

  it('counts recovered-this-week only when current=Green AND previous-week≠Green', async () => {
    userRef.current = pmUser;
    const currentMonday = isoWeekMondayUTC(new Date());
    const prevMonday = new Date(currentMonday.getTime() - 7 * 24 * 60 * 60 * 1000);

    db.project.findMany.mockResolvedValue([
      { id: 'p-recovered', name: 'Recovered', phase: 'Design', state: 'OnTrack', customerId: null, customer: null, keyDates: {}, details: {}, projectManagerId: null, solutionArchitectId: null, solutionConsultantId: null, ownerId: null },
      { id: 'p-still-green', name: 'Still Green', phase: 'Design', state: 'OnTrack', customerId: null, customer: null, keyDates: {}, details: {}, projectManagerId: null, solutionArchitectId: null, solutionConsultantId: null, ownerId: null },
      { id: 'p-amber', name: 'Still Amber', phase: 'Design', state: 'AtRisk', customerId: null, customer: null, keyDates: {}, details: {}, projectManagerId: null, solutionArchitectId: null, solutionConsultantId: null, ownerId: null },
    ]);

    // First $queryRaw call → risk-update history (newest first per project).
    // Second $queryRaw call → phase audit log latest (empty).
    // Third $queryRaw call → weekly RAG distribution (empty).
    db.$queryRaw
      .mockResolvedValueOnce([
        // p-recovered: this week Green, prev week Red → counted
        { project_id: 'p-recovered', week_of: currentMonday, rag_level: 'Green' },
        { project_id: 'p-recovered', week_of: prevMonday, rag_level: 'Red' },
        // p-still-green: this week Green, prev week also Green → NOT counted
        { project_id: 'p-still-green', week_of: currentMonday, rag_level: 'Green' },
        { project_id: 'p-still-green', week_of: prevMonday, rag_level: 'Green' },
        // p-amber: this week Amber → still at risk, NOT counted in recovered
        { project_id: 'p-amber', week_of: currentMonday, rag_level: 'Amber' },
      ])
      .mockResolvedValueOnce([]) // phase_audit_log
      .mockResolvedValueOnce([]); // weekly RAG

    const r = await app.inject({ method: 'GET', url: '/api/insights/overview' });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.payload);
    expect(body.kpis.recoveredThisWeek).toBe(1);
    expect(body.kpis.atRisk).toBe(1); // p-amber
    expect(body.kpis.activeProjects).toBe(3);
  });
});

describe('insights chat', () => {
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
    const r = await app.inject({
      method: 'POST',
      url: '/api/insights/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(r.statusCode).toBe(401);
  });

  it('returns 403 for a Viewer', async () => {
    userRef.current = viewerUser;
    const r = await app.inject({
      method: 'POST',
      url: '/api/insights/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(r.statusCode).toBe(403);
  });

  it('returns 503 when ANTHROPIC_API_KEY is not configured', async () => {
    userRef.current = pmUser;
    const r = await app.inject({
      method: 'POST',
      url: '/api/insights/chat',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(r.statusCode).toBe(503);
    const body = JSON.parse(r.payload);
    expect(body.error).toMatch(/ANTHROPIC_API_KEY/);
  });
});
