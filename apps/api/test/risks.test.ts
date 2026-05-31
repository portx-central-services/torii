import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { attachFakeUser, pmUser, viewerUser } from './helpers/auth-hook.js';
import type { DB } from '../src/db.js';
import type { AuthenticatedUser } from '../src/types.js';
import { isoWeekMondayUTC, toIsoDateUTC } from '../src/lib/iso-week.js';

function makeDbInner() {
  const project = { findUnique: vi.fn() };
  const projectRiskUpdate = {
    findMany: vi.fn(),
    upsert: vi.fn(),
  };
  const queryRaw = vi.fn();
  return { project, projectRiskUpdate, $queryRaw: queryRaw };
}

describe('risks routes', () => {
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

  describe('GET /api/risks', () => {
    it('returns 401 when unauthenticated', async () => {
      userRef.current = null;
      const r = await app.inject({ method: 'GET', url: '/api/risks' });
      expect(r.statusCode).toBe(401);
    });

    it('excludes Green latest updates and Done projects, returns Red/Amber with derived title', async () => {
      userRef.current = viewerUser;
      db.$queryRaw.mockResolvedValue([
        {
          project_id: 'p-red',
          project_name: 'Red One',
          week_of: new Date('2026-05-25T00:00:00Z'),
          rag_level: 'Red',
          risk_types: ['Technical'],
          state: 'Blocked',
          description: 'Production payment processor outage causing weekly delays',
        },
        {
          project_id: 'p-green',
          project_name: 'Green One',
          week_of: new Date('2026-05-25T00:00:00Z'),
          rag_level: 'Green',
          risk_types: ['Schedule'],
          state: 'Inform',
          description: 'Things are fine',
        },
      ]);

      const r = await app.inject({ method: 'GET', url: '/api/risks' });
      expect(r.statusCode).toBe(200);
      const body = r.json() as Array<{ projectId: string; ragLevel: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        projectId: 'p-red',
        projectName: 'Red One',
        ragLevel: 'Red',
        state: 'Blocked',
        title: 'Production payment processor outage causing weekly delays',
      });
    });

    it('truncates the title at 120 characters', async () => {
      userRef.current = viewerUser;
      const long = 'A'.repeat(200);
      db.$queryRaw.mockResolvedValue([
        {
          project_id: 'p',
          project_name: 'Long',
          week_of: new Date('2026-05-25T00:00:00Z'),
          rag_level: 'Amber',
          risk_types: ['Resourcing'],
          state: 'Inform',
          description: long,
        },
      ]);
      const r = await app.inject({ method: 'GET', url: '/api/risks' });
      const body = r.json() as Array<{ title: string }>;
      expect(body[0]!.title.length).toBe(120);
      expect(body[0]!.title.endsWith('…')).toBe(true);
    });
  });

  describe('GET /api/projects/:id/risk-updates', () => {
    it('returns history newest first when authenticated', async () => {
      userRef.current = viewerUser;
      db.project.findUnique.mockResolvedValue({ id: 'proj-1' });
      db.projectRiskUpdate.findMany.mockResolvedValue([
        {
          id: 'u2',
          projectId: 'proj-1',
          weekOf: new Date('2026-05-25T00:00:00Z'),
          ragLevel: 'Amber',
          riskTypes: ['Schedule'],
          state: 'Inform',
          description: 'b',
          goToGreenPlan: '',
          latestUpdate: '',
          nextSteps: '',
          actionRequested: '',
          authorId: 'pm-1',
          author: { name: 'PM One' },
          createdAt: new Date('2026-05-25T00:00:00Z'),
          updatedAt: new Date('2026-05-25T00:00:00Z'),
        },
      ]);
      const r = await app.inject({
        method: 'GET',
        url: '/api/projects/proj-1/risk-updates',
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as Array<{ id: string; weekOf: string }>;
      expect(body[0]).toMatchObject({ id: 'u2', weekOf: '2026-05-25' });
    });

    it('returns 404 when the project is missing', async () => {
      userRef.current = viewerUser;
      db.project.findUnique.mockResolvedValue(null);
      const r = await app.inject({
        method: 'GET',
        url: '/api/projects/missing/risk-updates',
      });
      expect(r.statusCode).toBe(404);
    });

    it('returns 401 unauthenticated', async () => {
      const r = await app.inject({
        method: 'GET',
        url: '/api/projects/proj-1/risk-updates',
      });
      expect(r.statusCode).toBe(401);
    });
  });

  describe('POST /api/projects/:id/risk-updates', () => {
    const validBody = {
      ragLevel: 'Amber',
      riskTypes: ['Technical'],
      state: 'Inform',
      description: 'something',
      goToGreenPlan: 'plan',
      latestUpdate: 'update',
      nextSteps: 'next',
      actionRequested: 'help',
    };

    it('rejects a non-PM with 403', async () => {
      userRef.current = viewerUser;
      const r = await app.inject({
        method: 'POST',
        url: '/api/projects/proj-1/risk-updates',
        payload: validBody,
      });
      expect(r.statusCode).toBe(403);
    });

    it('upserts when no explicit weekOf is provided (uses current ISO week)', async () => {
      userRef.current = pmUser;
      db.project.findUnique.mockResolvedValue({ id: 'proj-1' });
      const now = new Date();
      const currentMonday = isoWeekMondayUTC(now);
      db.projectRiskUpdate.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
        id: 'new-row',
        projectId: 'proj-1',
        weekOf: currentMonday,
        ragLevel: validBody.ragLevel,
        riskTypes: validBody.riskTypes,
        state: validBody.state,
        description: validBody.description,
        goToGreenPlan: validBody.goToGreenPlan,
        latestUpdate: validBody.latestUpdate,
        nextSteps: validBody.nextSteps,
        actionRequested: validBody.actionRequested,
        authorId: pmUser.id,
        author: { name: pmUser.name },
        createdAt: now,
        updatedAt: now,
        ...args.create,
      }));

      const r = await app.inject({
        method: 'POST',
        url: '/api/projects/proj-1/risk-updates',
        payload: validBody,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { weekOf: string; authorId: string };
      expect(body.weekOf).toBe(toIsoDateUTC(currentMonday));
      expect(body.authorId).toBe(pmUser.id);
      expect(db.projectRiskUpdate.upsert).toHaveBeenCalled();
    });

    it('rejects a past or future weekOf with 400', async () => {
      userRef.current = pmUser;
      db.project.findUnique.mockResolvedValue({ id: 'proj-1' });
      const r = await app.inject({
        method: 'POST',
        url: '/api/projects/proj-1/risk-updates',
        payload: { ...validBody, weekOf: '2020-01-06' }, // a Monday far in the past
      });
      expect(r.statusCode).toBe(400);
      expect(db.projectRiskUpdate.upsert).not.toHaveBeenCalled();
    });

    it('rejects an empty riskTypes with 400', async () => {
      userRef.current = pmUser;
      db.project.findUnique.mockResolvedValue({ id: 'proj-1' });
      const r = await app.inject({
        method: 'POST',
        url: '/api/projects/proj-1/risk-updates',
        payload: { ...validBody, riskTypes: [] },
      });
      expect(r.statusCode).toBe(400);
    });
  });
});

describe('isoWeekMondayUTC', () => {
  it('returns the Monday for any day of the ISO week', () => {
    // 2026-06-03 is a Wednesday → Monday is 2026-06-01
    const mid = new Date('2026-06-03T15:00:00Z');
    expect(toIsoDateUTC(isoWeekMondayUTC(mid))).toBe('2026-06-01');
    // A Sunday rolls back to the previous Monday
    const sun = new Date('2026-06-07T22:00:00Z');
    expect(toIsoDateUTC(isoWeekMondayUTC(sun))).toBe('2026-06-01');
    // A Monday returns itself
    const mon = new Date('2026-06-01T00:00:00Z');
    expect(toIsoDateUTC(isoWeekMondayUTC(mon))).toBe('2026-06-01');
  });
});
