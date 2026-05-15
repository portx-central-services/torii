import { Prisma, TrackerConnectionStatus } from '@prisma/client';
import type { TrackerConnection } from '@prisma/client';
import type { TrackerAdapter, TrackerProvider } from '@torii/shared';
import type { DB } from '../db.js';
import { decryptToken } from './encryption.js';
import { getAdapterFactory } from './registry.js';
import { mergeExternalIntoTorii, type ExistingProjectSlice } from './merge-fields.js';
import { MondayAuthError, MondayRateLimitError } from './monday/MondayAdapter.js';

export interface SyncResult {
  connectionId: string;
  status: TrackerConnectionStatus;
  syncedAt: Date;
  projectsScanned: number;
  projectsPatched: number;
  error?: string;
}

export interface SyncEngineOptions {
  db: DB;
  trackerTokenKey: string;
}

function statusForError(err: unknown): TrackerConnectionStatus {
  if (err instanceof MondayAuthError) return TrackerConnectionStatus.auth_failed;
  if (err instanceof MondayRateLimitError) return TrackerConnectionStatus.rate_limited;
  return TrackerConnectionStatus.ok;
}

function trackerRefMatches(
  trackerRef: Prisma.JsonValue | null | undefined,
  provider: TrackerProvider,
  externalId: string,
): boolean {
  if (!trackerRef || typeof trackerRef !== 'object' || Array.isArray(trackerRef)) {
    return false;
  }
  const obj = trackerRef as Record<string, unknown>;
  return obj.provider === provider && obj.externalId === externalId;
}

export class SyncEngine {
  constructor(private readonly opts: SyncEngineOptions) {}

  /** Sync every linked project for the given connection. */
  async syncConnection(connectionId: string): Promise<SyncResult> {
    const { db } = this.opts;
    const connection = await db.trackerConnection.findUnique({ where: { id: connectionId } });
    if (!connection) throw new Error(`TrackerConnection ${connectionId} not found`);

    return this.runSync(connection, async (adapter) => {
      const externals = await adapter.listProjects();

      // Load all projects linked to a tracker; filter by provider+externalId in memory.
      const linkedProjects = await db.project.findMany({
        where: { trackerRef: { not: Prisma.JsonNull } },
      });

      let patched = 0;
      for (const external of externals) {
        const project = linkedProjects.find((p) =>
          trackerRefMatches(p.trackerRef, connection.provider, external.externalId),
        );
        if (!project) continue;

        const existing: ExistingProjectSlice = {
          name: project.name,
          keyDates: (project.keyDates as Record<string, string | undefined>) ?? {},
        };
        const fieldMapping =
          (project.fieldMapping as Record<string, 'torii' | 'monday'> | null) ?? null;
        const patch = mergeExternalIntoTorii(existing, external, fieldMapping);
        if (Object.keys(patch).length === 0) continue;

        await db.project.update({
          where: { id: project.id },
          data: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.keyDates !== undefined ? { keyDates: patch.keyDates } : {}),
          },
        });
        patched += 1;
      }
      return { scanned: externals.length, patched };
    });
  }

  /** Sync one Torii project against its linked tracker item. */
  async syncProject(projectId: string): Promise<SyncResult | null> {
    const { db } = this.opts;
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error(`Project ${projectId} not found`);

    const trackerRef = project.trackerRef as
      | { provider?: TrackerProvider; externalId?: string }
      | null;
    if (!trackerRef?.provider || !trackerRef.externalId) return null;
    const externalId = trackerRef.externalId;

    const connection = await db.trackerConnection.findFirst({
      where: {
        provider: trackerRef.provider,
        status: { not: TrackerConnectionStatus.auth_failed },
      },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!connection) return null;

    return this.runSync(connection, async (adapter) => {
      const external = await adapter.getProject(externalId);
      if (!external) return { scanned: 1, patched: 0 };

      const existing: ExistingProjectSlice = {
        name: project.name,
        keyDates: (project.keyDates as Record<string, string | undefined>) ?? {},
      };
      const fieldMapping =
        (project.fieldMapping as Record<string, 'torii' | 'monday'> | null) ?? null;
      const patch = mergeExternalIntoTorii(existing, external, fieldMapping);
      if (Object.keys(patch).length === 0) return { scanned: 1, patched: 0 };

      await db.project.update({
        where: { id: project.id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.keyDates !== undefined ? { keyDates: patch.keyDates } : {}),
        },
      });
      return { scanned: 1, patched: 1 };
    });
  }

  /** Sync every connection that is not in auth_failed. Used by the cron tick. */
  async syncAllActive(): Promise<SyncResult[]> {
    const { db } = this.opts;
    const connections = await db.trackerConnection.findMany({
      where: { status: { not: TrackerConnectionStatus.auth_failed } },
    });
    const out: SyncResult[] = [];
    for (const c of connections) {
      try {
        out.push(await this.syncConnection(c.id));
      } catch (err) {
        out.push({
          connectionId: c.id,
          status: statusForError(err),
          syncedAt: new Date(),
          projectsScanned: 0,
          projectsPatched: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return out;
  }

  private async runSync(
    connection: TrackerConnection,
    work: (adapter: TrackerAdapter) => Promise<{ scanned: number; patched: number }>,
  ): Promise<SyncResult> {
    const { db, trackerTokenKey } = this.opts;
    const syncedAt = new Date();
    let status: TrackerConnectionStatus = TrackerConnectionStatus.ok;
    let scanned = 0;
    let patched = 0;
    let error: string | undefined;

    try {
      const accessToken = decryptToken(connection.accessTokenEnc, trackerTokenKey);
      const factory = getAdapterFactory(connection.provider);
      const adapter = factory({ workspace: connection.workspace, accessToken });
      const result = await work(adapter);
      scanned = result.scanned;
      patched = result.patched;
    } catch (err) {
      status = statusForError(err);
      error = err instanceof Error ? err.message : String(err);
    }

    await db.trackerConnection.update({
      where: { id: connection.id },
      data: {
        status,
        lastSyncedAt: status === TrackerConnectionStatus.ok ? syncedAt : connection.lastSyncedAt,
      },
    });

    return {
      connectionId: connection.id,
      status,
      syncedAt,
      projectsScanned: scanned,
      projectsPatched: patched,
      ...(error ? { error } : {}),
    };
  }
}
