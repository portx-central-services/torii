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
        { externalId: '101', name: 'Acme RENAMED', targetGoLive: '2026-09-01' },
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
          phase: 'Build',
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
            { externalId: '101', name: 'Updated', targetGoLive: '2026-12-01' },
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
