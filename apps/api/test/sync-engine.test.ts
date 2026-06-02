import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine } from '../src/sync/engine.js';
import { registerAdapter, clearRegistry } from '../src/sync/registry.js';
import { encryptToken } from '../src/sync/encryption.js';
import type { TrackerAdapter, ExternalProject } from '@torii/shared';
import type { DB } from '../src/db.js';

const KEY = '0'.repeat(64);
const encrypted = (plain: string) => encryptToken(plain, KEY);

function makeDb() {
  return {
    trackerConnection: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

function mockAdapter(impl: Partial<TrackerAdapter>): TrackerAdapter {
  return {
    listProjects: vi.fn(),
    getProject: vi.fn(),
    getMetadata: vi.fn().mockResolvedValue({
      provider: 'monday',
      workspace: 'w',
      capabilities: { listProjects: true, getProject: true },
    }),
    ...impl,
  } as TrackerAdapter;
}

describe('SyncEngine', () => {
  let db: ReturnType<typeof makeDb>;
  let engine: SyncEngine;

  beforeEach(() => {
    clearRegistry();
    db = makeDb();
    engine = new SyncEngine({ db: db as unknown as DB, trackerTokenKey: KEY });
  });

  afterEach(() => {
    clearRegistry();
  });

  describe('syncConnection happy path', () => {
    it('patches a linked project when external name differs (monday-owned)', async () => {
      const externals: ExternalProject[] = [
        { externalId: '101', name: 'Acme RENAMED', keyDates: { target_go_live: '2026-09-01' } },
      ];
      const adapter = mockAdapter({ listProjects: vi.fn().mockResolvedValue(externals) });
      registerAdapter('monday', () => adapter);

      db.trackerConnection.findUnique.mockResolvedValue({
        id: 'c1',
        provider: 'monday',
        workspace: 'w',
        accessTokenEnc: encrypted('tok'),
        refreshTokenEnc: null,
        status: 'ok',
        lastSyncedAt: null,
      });
      db.project.findMany.mockResolvedValue([
        {
          id: 'proj-1',
          name: 'Acme',
          phase: 'Development',
          state: 'OnTrack',
          keyDates: {},
          trackerRef: { provider: 'monday', externalId: '101' },
          fieldMapping: {},
        },
      ]);

      const result = await engine.syncConnection('c1');

      expect(result.status).toBe('ok');
      expect(result.projectsScanned).toBe(1);
      expect(result.projectsPatched).toBe(1);
      expect(db.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: expect.objectContaining({ name: 'Acme RENAMED' }),
      });
      expect(db.trackerConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({ status: 'ok', lastSyncedAt: expect.any(Date) }),
      });
    });

    it('skips externals with no matching Torii project', async () => {
      const externals: ExternalProject[] = [
        { externalId: 'orphan', name: 'Not yet imported' },
      ];
      registerAdapter('monday', () =>
        mockAdapter({ listProjects: vi.fn().mockResolvedValue(externals) }),
      );

      db.trackerConnection.findUnique.mockResolvedValue({
        id: 'c1',
        provider: 'monday',
        workspace: 'w',
        accessTokenEnc: encrypted('tok'),
        refreshTokenEnc: null,
        status: 'ok',
        lastSyncedAt: null,
      });
      db.project.findMany.mockResolvedValue([]);

      const result = await engine.syncConnection('c1');
      expect(result.projectsScanned).toBe(1);
      expect(result.projectsPatched).toBe(0);
      expect(db.project.update).not.toHaveBeenCalled();
    });

    it('preserves Torii-owned phase when field_mapping says so', async () => {
      registerAdapter('monday', () =>
        mockAdapter({
          listProjects: vi.fn().mockResolvedValue([
            { externalId: '101', name: 'Updated', keyDates: { target_go_live: '2026-12-01' } },
          ]),
        }),
      );

      db.trackerConnection.findUnique.mockResolvedValue({
        id: 'c1',
        provider: 'monday',
        workspace: 'w',
        accessTokenEnc: encrypted('tok'),
        refreshTokenEnc: null,
        status: 'ok',
        lastSyncedAt: null,
      });
      db.project.findMany.mockResolvedValue([
        {
          id: 'proj-1',
          name: 'Original',
          phase: 'UAT',
          state: 'OnTrack',
          keyDates: { target_go_live: '2026-09-01' },
          trackerRef: { provider: 'monday', externalId: '101' },
          fieldMapping: {
            name: 'torii',
            'key_dates.target_go_live': 'torii',
          },
        },
      ]);

      const result = await engine.syncConnection('c1');
      expect(result.projectsPatched).toBe(0);
      // The row is still touched so trackerRaw stays fresh, but name and keyDates
      // must NOT be in the update payload because field_mapping says torii-owned.
      expect(db.project.update).toHaveBeenCalledTimes(1);
      const updateArg = db.project.update.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(updateArg.data).not.toHaveProperty('name');
      expect(updateArg.data).not.toHaveProperty('keyDates');
      expect(updateArg.data).toHaveProperty('trackerRaw');
    });

    it('refreshes trackerRaw even when external matches existing (empty patch)', async () => {
      const rawPayload = { id: '101', name: 'Acme', column_values: [{ id: 'status', text: 'On track' }] };
      registerAdapter('monday', () =>
        mockAdapter({
          listProjects: vi.fn().mockResolvedValue([
            {
              externalId: '101',
              name: 'Acme',
              keyDates: { target_go_live: '2026-09-01' },
              raw: rawPayload,
            },
          ]),
        }),
      );

      db.trackerConnection.findUnique.mockResolvedValue({
        id: 'c1',
        provider: 'monday',
        workspace: 'w',
        accessTokenEnc: encrypted('tok'),
        refreshTokenEnc: null,
        status: 'ok',
        lastSyncedAt: null,
      });
      db.project.findMany.mockResolvedValue([
        {
          id: 'proj-1',
          name: 'Acme',
          phase: 'Development',
          state: 'OnTrack',
          keyDates: { target_go_live: '2026-09-01' },
          trackerRef: { provider: 'monday', externalId: '101' },
          fieldMapping: {},
        },
      ]);

      const result = await engine.syncConnection('c1');
      expect(result.projectsPatched).toBe(0);
      expect(db.project.update).toHaveBeenCalledTimes(1);
      const updateArg = db.project.update.mock.calls[0]![0] as { data: Record<string, unknown> };
      // trackerRaw refreshes even with an empty merge patch; the post-extraction
      // person resolution also writes the three FK columns (all null here since
      // the test fixture has no role strings in details).
      expect(updateArg.data).toEqual({
        trackerRaw: rawPayload,
        projectManagerId: null,
        solutionArchitectId: null,
        solutionConsultantId: null,
      });
    });
  });

  describe('syncConnection force mode', () => {
    it('isolates per-item errors and refreshes trackerRaw for survivors', async () => {
      const rawForB = { id: '102', name: 'Beta', column_values: [{ id: 'status', text: 'At risk' }] };
      const getProject = vi.fn(async (externalId: string) => {
        if (externalId === '101') throw new Error('boom: network');
        if (externalId === '102') {
          return {
            externalId: '102',
            name: 'Beta RENAMED',
            keyDates: { target_go_live: '2026-10-01' },
            raw: rawForB,
          };
        }
        return null;
      });
      registerAdapter('monday', () => mockAdapter({ getProject }));

      db.trackerConnection.findUnique.mockResolvedValue({
        id: 'c1',
        provider: 'monday',
        workspace: 'w',
        accessTokenEnc: encrypted('tok'),
        refreshTokenEnc: null,
        status: 'ok',
        lastSyncedAt: null,
      });
      db.project.findMany.mockResolvedValue([
        {
          id: 'proj-A',
          name: 'Alpha',
          phase: 'Development',
          state: 'OnTrack',
          keyDates: {},
          trackerRef: { provider: 'monday', externalId: '101' },
          fieldMapping: {},
        },
        {
          id: 'proj-B',
          name: 'Beta',
          phase: 'Development',
          state: 'OnTrack',
          keyDates: {},
          trackerRef: { provider: 'monday', externalId: '102' },
          fieldMapping: {},
        },
      ]);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const result = await engine.syncConnection('c1', { force: true });
        expect(result.status).toBe('ok');
        expect(result.projectsScanned).toBe(1);
        expect(result.projectsPatched).toBe(1);

        // Only proj-B should have been updated; proj-A errored and was skipped.
        expect(db.project.update).toHaveBeenCalledTimes(1);
        const updateArg = db.project.update.mock.calls[0]![0] as {
          where: { id: string };
          data: Record<string, unknown>;
        };
        expect(updateArg.where.id).toBe('proj-B');
        expect(updateArg.data).toMatchObject({ name: 'Beta RENAMED', trackerRaw: rawForB });

        // The per-item error must have been logged.
        expect(consoleSpy).toHaveBeenCalledWith(
          '[SyncEngine.forceRefreshLinked]',
          expect.objectContaining({
            connectionId: 'c1',
            projectId: 'proj-A',
            externalId: '101',
          }),
        );
      } finally {
        consoleSpy.mockRestore();
      }
    });

    it('rethrows MondayAuthError so the connection is marked auth_failed', async () => {
      const { MondayAuthError } = await import('../src/sync/monday/MondayAdapter.js');
      const getProject = vi.fn().mockRejectedValue(new MondayAuthError());
      registerAdapter('monday', () => mockAdapter({ getProject }));

      db.trackerConnection.findUnique.mockResolvedValue({
        id: 'c1',
        provider: 'monday',
        workspace: 'w',
        accessTokenEnc: encrypted('tok'),
        refreshTokenEnc: null,
        status: 'ok',
        lastSyncedAt: new Date('2026-01-01'),
      });
      db.project.findMany.mockResolvedValue([
        {
          id: 'proj-A',
          name: 'Alpha',
          phase: 'Development',
          state: 'OnTrack',
          keyDates: {},
          trackerRef: { provider: 'monday', externalId: '101' },
          fieldMapping: {},
        },
      ]);

      const result = await engine.syncConnection('c1', { force: true });
      expect(result.status).toBe('auth_failed');
      expect(db.project.update).not.toHaveBeenCalled();
    });
  });

  describe('auth_failed branch', () => {
    it('marks the connection auth_failed when adapter throws MondayAuthError', async () => {
      const { MondayAuthError } = await import('../src/sync/monday/MondayAdapter.js');
      registerAdapter('monday', () =>
        mockAdapter({ listProjects: vi.fn().mockRejectedValue(new MondayAuthError()) }),
      );
      db.trackerConnection.findUnique.mockResolvedValue({
        id: 'c1',
        provider: 'monday',
        workspace: 'w',
        accessTokenEnc: encrypted('tok'),
        refreshTokenEnc: null,
        status: 'ok',
        lastSyncedAt: new Date('2026-01-01'),
      });

      const result = await engine.syncConnection('c1');
      expect(result.status).toBe('auth_failed');
      expect(db.trackerConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: expect.objectContaining({
          status: 'auth_failed',
          // lastSyncedAt unchanged on failure
          lastSyncedAt: new Date('2026-01-01'),
        }),
      });
    });
  });

  describe('syncAllActive', () => {
    it('iterates over all non-auth_failed connections', async () => {
      registerAdapter('monday', () =>
        mockAdapter({ listProjects: vi.fn().mockResolvedValue([]) }),
      );
      db.trackerConnection.findMany.mockResolvedValue([
        { id: 'c1' }, // syncConnection will refetch by id
        { id: 'c2' },
      ]);
      db.trackerConnection.findUnique.mockImplementation(({ where }: { where: { id: string } }) => ({
        id: where.id,
        provider: 'monday',
        workspace: 'w',
        accessTokenEnc: encrypted('tok'),
        refreshTokenEnc: null,
        status: 'ok',
        lastSyncedAt: null,
      }));
      db.project.findMany.mockResolvedValue([]);

      const results = await engine.syncAllActive();
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.connectionId).sort()).toEqual(['c1', 'c2']);
    });
  });
});
