import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { attachFakeUser, pmUser, viewerUser } from './helpers/auth-hook.js';
import type { DB } from '../src/db.js';
import type { AuthenticatedUser } from '../src/types.js';

function baseProject() {
  return {
    id: 'proj-1',
    name: 'Acme integration',
    phase: 'Build',
    state: 'OnTrack',
    keyDates: { kickoff: '2026-06-01', target_go_live: '2026-09-01' },
    ownerId: null,
    trackerRef: null,
    fieldMapping: {},
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  };
}

function makeDbInner() {
  const project = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const phaseAuditLog = { create: vi.fn() };
  const trackerConnection = { findFirst: vi.fn() };
  const tx = { project, phaseAuditLog };
  const $transaction = vi.fn(async (fn: (tx: { project: typeof project; phaseAuditLog: typeof phaseAuditLog }) => unknown) => fn(tx));
  return { project, phaseAuditLog, trackerConnection, $transaction, tx };
}

describe('projects routes', () => {
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

  describe('GET /api/projects', () => {
    it('returns 401 when unauthenticated', async () => {
      userRef.current = null;
      const r = await app.inject({ method: 'GET', url: '/api/projects' });
      expect(r.statusCode).toBe(401);
    });

    it('lists projects with no filters', async () => {
      userRef.current = viewerUser;
      db.project.findMany.mockResolvedValue([baseProject()]);
      const r = await app.inject({ method: 'GET', url: '/api/projects' });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toHaveLength(1);
      expect(db.project.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { name: 'asc' },
      });
    });

    it('passes phase and state filters through to Prisma', async () => {
      userRef.current = viewerUser;
      db.project.findMany.mockResolvedValue([]);
      await app.inject({
        method: 'GET',
        url: '/api/projects?phase=Build&state=Blocked',
      });
      expect(db.project.findMany).toHaveBeenCalledWith({
        where: { phase: 'Build', state: 'Blocked' },
        orderBy: { name: 'asc' },
      });
    });

    it('rejects an invalid filter value', async () => {
      userRef.current = viewerUser;
      const r = await app.inject({
        method: 'GET',
        url: '/api/projects?phase=NotAPhase',
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('POST /api/projects', () => {
    it('rejects Viewer with 403', async () => {
      userRef.current = viewerUser;
      const r = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: 'New project' },
      });
      expect(r.statusCode).toBe(403);
      expect(db.project.create).not.toHaveBeenCalled();
    });

    it('creates a project for a PM', async () => {
      userRef.current = pmUser;
      db.project.create.mockResolvedValue({ ...baseProject(), name: 'New project', id: 'new-1' });
      const r = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: 'New project' },
      });
      expect(r.statusCode).toBe(201);
      expect(db.project.create).toHaveBeenCalled();
    });

    it('rejects invalid phase enum', async () => {
      userRef.current = pmUser;
      const r = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: 'X', phase: 'NotAPhase' },
      });
      expect(r.statusCode).toBe(400);
    });

    it('rejects target_go_live before kickoff', async () => {
      userRef.current = pmUser;
      const r = await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: {
          name: 'X',
          keyDates: { kickoff: '2026-06-01', target_go_live: '2026-05-15' },
        },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('writes a PhaseAuditLog on phase change', async () => {
      userRef.current = pmUser;
      const project = baseProject();
      db.project.findUnique.mockResolvedValue(project);
      db.project.update.mockResolvedValue({ ...project, phase: 'UAT' });

      const r = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}`,
        payload: { phase: 'UAT' },
      });
      expect(r.statusCode).toBe(200);
      expect(db.phaseAuditLog.create).toHaveBeenCalledWith({
        data: {
          projectId: project.id,
          fromPhase: 'Build',
          toPhase: 'UAT',
          actorId: pmUser.id,
        },
      });
    });

    it('auto-sets state to Done when phase advances to Hypercare with actual_go_live set', async () => {
      userRef.current = pmUser;
      const project = {
        ...baseProject(),
        phase: 'Launch',
        keyDates: { kickoff: '2026-06-01', target_go_live: '2026-09-01' },
      };
      db.project.findUnique.mockResolvedValue(project);
      db.project.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        ...project,
        ...args.data,
      }));

      const r = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}`,
        payload: { phase: 'Hypercare', keyDates: { actual_go_live: '2026-09-05' } },
      });
      expect(r.statusCode).toBe(200);
      const updateCall = db.project.update.mock.calls[0]?.[0] as { data: { state: string } };
      expect(updateCall.data.state).toBe('Done');
    });

    it('does NOT auto-set state to Done when caller passes explicit state', async () => {
      userRef.current = pmUser;
      const project = { ...baseProject(), phase: 'Launch' };
      db.project.findUnique.mockResolvedValue(project);
      db.project.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        ...project,
        ...args.data,
      }));

      await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}`,
        payload: {
          phase: 'Hypercare',
          state: 'AtRisk',
          keyDates: { actual_go_live: '2026-09-05' },
        },
      });
      const updateCall = db.project.update.mock.calls[0]?.[0] as { data: { state: string } };
      expect(updateCall.data.state).toBe('AtRisk');
    });

    it('rejects Viewer with 403', async () => {
      userRef.current = viewerUser;
      const r = await app.inject({
        method: 'PATCH',
        url: '/api/projects/proj-1',
        payload: { phase: 'UAT' },
      });
      expect(r.statusCode).toBe(403);
    });

    it('returns 404 when project does not exist', async () => {
      userRef.current = pmUser;
      db.project.findUnique.mockResolvedValue(null);
      const r = await app.inject({
        method: 'PATCH',
        url: '/api/projects/missing',
        payload: { phase: 'UAT' },
      });
      expect(r.statusCode).toBe(404);
    });
  });
});
