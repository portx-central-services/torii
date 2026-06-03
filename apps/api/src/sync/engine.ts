import { Prisma, TrackerConnectionStatus } from '@prisma/client';
import type { TrackerConnection } from '@prisma/client';
import type { ExternalProject, TrackerAdapter, TrackerProvider } from '@torii/shared';
import type { DB } from '../db.js';
import { decryptToken } from './encryption.js';
import { getAdapterFactory } from './registry.js';
import { mergeExternalIntoTorii, type ExistingProjectSlice } from './merge-fields.js';
import { MondayAuthError, MondayRateLimitError } from './monday/MondayAdapter.js';
import { HarvestAdapter, HarvestAuthError, HarvestRateLimitError } from './harvest/HarvestAdapter.js';
import { resolvePeopleIdsFromDetails } from './resolve-people.js';

/** Harvest's rate limit is 100 req / 15s. We pace at 50/15s to leave headroom for on-demand calls. */
const HARVEST_BATCH_SIZE = 50;
const HARVEST_BATCH_WAIT_MS = 15_000;

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

  /**
   * Sync every linked project for the given connection.
   *
   * When `opts.force` is true, refetch each linked project individually via
   * `adapter.getProject(externalId)` so items missed by `listProjects` pagination
   * still get refreshed. The cron tick keeps the default (bulk) path.
   */
  async syncConnection(
    connectionId: string,
    opts: { force?: boolean } = {},
  ): Promise<SyncResult> {
    const { db } = this.opts;
    const connection = await db.trackerConnection.findUnique({ where: { id: connectionId } });
    if (!connection) throw new Error(`TrackerConnection ${connectionId} not found`);

    // Harvest's sync semantics are different from Monday's: Harvest never feeds the
    // merge engine (no name/phase/details/keyDates to merge). Instead, refresh the
    // cached `project_harvest_snapshots` row for every project linked to a Harvest
    // project on this connection.
    if (connection.provider === ('harvest' as TrackerProvider)) {
      return this.syncHarvestConnection(connection);
    }

    return this.runSync(connection, async (adapter) => {
      if (opts.force) {
        return this.forceRefreshLinked(adapter, connection.provider, connectionId);
      }

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
          phase: project.phase,
          keyDates: (project.keyDates as Record<string, string | undefined>) ?? {},
          details: (project.details as Record<string, string | undefined>) ?? {},
        };
        const fieldMapping =
          (project.fieldMapping as Record<string, 'torii' | 'monday'> | null) ?? null;
        const patch = mergeExternalIntoTorii(existing, external, fieldMapping);
        // Post-extraction person resolution: walk the merged details, return FK ids.
        // May create Person rows for new names. Folded into the single project.update
        // below so each project gets exactly one write per sync iteration.
        const peopleIds = await resolvePeopleIdsFromDetails(
          db,
          patch.details ?? existing.details,
        );

        await db.project.update({
          where: { id: project.id },
          data: {
            trackerRaw: (external.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
            ...(patch.keyDates !== undefined ? { keyDates: patch.keyDates } : {}),
            ...(patch.details !== undefined ? { details: patch.details } : {}),
            projectManagerId: peopleIds.projectManagerId,
            solutionArchitectId: peopleIds.solutionArchitectId,
            solutionConsultantId: peopleIds.solutionConsultantId,
          },
        });
        if (Object.keys(patch).length > 0) patched += 1;
      }
      return { scanned: externals.length, patched };
    });
  }

  private async forceRefreshLinked(
    adapter: TrackerAdapter,
    provider: TrackerProvider,
    connectionId: string,
  ): Promise<{ scanned: number; patched: number }> {
    const { db } = this.opts;
    const linkedProjects = await db.project.findMany({
      where: { trackerRef: { not: Prisma.JsonNull } },
    });
    const ourProjects = linkedProjects.filter((p) => {
      const ref = p.trackerRef as { provider?: string; externalId?: string } | null;
      return ref?.provider === provider && typeof ref.externalId === 'string';
    });

    let scanned = 0;
    let patched = 0;
    for (const project of ourProjects) {
      const ref = project.trackerRef as { externalId: string };
      let external: ExternalProject | null;
      try {
        external = await adapter.getProject(ref.externalId);
      } catch (err) {
        // Auth/rate-limit failures are connection-level — rethrow so the
        // outer runSync marks the connection appropriately.
        if (err instanceof MondayAuthError || err instanceof MondayRateLimitError) throw err;
        // Per-item errors: log and continue so other items still sync.
        console.error('[SyncEngine.forceRefreshLinked]', {
          connectionId,
          projectId: project.id,
          externalId: ref.externalId,
          err: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (!external) continue;
      scanned += 1;

      const existing: ExistingProjectSlice = {
        name: project.name,
        phase: project.phase,
        keyDates: (project.keyDates as Record<string, string | undefined>) ?? {},
        details: (project.details as Record<string, string | undefined>) ?? {},
      };
      const fieldMapping =
        (project.fieldMapping as Record<string, 'torii' | 'monday'> | null) ?? null;
      const patch = mergeExternalIntoTorii(existing, external, fieldMapping);

      const peopleIds = await resolvePeopleIdsFromDetails(
        db,
        patch.details ?? existing.details,
      );

      await db.project.update({
        where: { id: project.id },
        data: {
          trackerRaw: (external.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
          ...(patch.keyDates !== undefined ? { keyDates: patch.keyDates } : {}),
          ...(patch.details !== undefined ? { details: patch.details } : {}),
          projectManagerId: peopleIds.projectManagerId,
          solutionArchitectId: peopleIds.solutionArchitectId,
          solutionConsultantId: peopleIds.solutionConsultantId,
        },
      });
      if (Object.keys(patch).length > 0) patched += 1;
    }
    return { scanned, patched };
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
        phase: project.phase,
        keyDates: (project.keyDates as Record<string, string | undefined>) ?? {},
        details: (project.details as Record<string, string | undefined>) ?? {},
      };
      const fieldMapping =
        (project.fieldMapping as Record<string, 'torii' | 'monday'> | null) ?? null;
      const patch = mergeExternalIntoTorii(existing, external, fieldMapping);

      const peopleIds = await resolvePeopleIdsFromDetails(
        db,
        patch.details ?? existing.details,
      );

      await db.project.update({
        where: { id: project.id },
        data: {
          trackerRaw: (external.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.phase !== undefined ? { phase: patch.phase } : {}),
          ...(patch.keyDates !== undefined ? { keyDates: patch.keyDates } : {}),
          ...(patch.details !== undefined ? { details: patch.details } : {}),
          projectManagerId: peopleIds.projectManagerId,
          solutionArchitectId: peopleIds.solutionArchitectId,
          solutionConsultantId: peopleIds.solutionConsultantId,
        },
      });
      return { scanned: 1, patched: Object.keys(patch).length > 0 ? 1 : 0 };
    });
  }

  /**
   * Refresh the cached snapshot for every project linked to a Harvest project on
   * this connection. Paces calls at `HARVEST_BATCH_SIZE` per `HARVEST_BATCH_WAIT_MS`
   * to respect the 100 req / 15 sec limit (design D10). Per-project 429 / per-item
   * errors are logged and skipped so the rest of the batch still gets refreshed.
   */
  private async syncHarvestConnection(connection: TrackerConnection): Promise<SyncResult> {
    const { db } = this.opts;
    const syncedAt = new Date();
    if (!connection.harvestAccountId) {
      return {
        connectionId: connection.id,
        status: TrackerConnectionStatus.auth_failed,
        syncedAt,
        projectsScanned: 0,
        projectsPatched: 0,
        error: 'Harvest connection is missing account ID',
      };
    }
    const accessToken = decryptToken(connection.accessTokenEnc, this.opts.trackerTokenKey);
    const adapter = new HarvestAdapter({
      workspace: connection.workspace,
      accessToken,
      accountId: connection.harvestAccountId,
    });

    let status: TrackerConnectionStatus = TrackerConnectionStatus.ok;
    let topLevelError: string | undefined;

    // Step 1 — ingest Harvest clients into local Customers.
    // Auto-create a Customer the first time we see a Harvest client (the Harvest
    // client IS the customer; making the admin click "Create" was needless friction).
    // Once a Customer row exists we leave its name alone — admin owns rename per D7.
    // To merge two Harvest clients into one Torii customer, the admin rebinds via
    // /trackers (which clears the auto-created row's harvest_client_id).
    try {
      const clients = await adapter.listClients();
      for (const c of clients) {
        const existing = await db.customer.findUnique({
          where: { harvestClientId: c.id },
        });
        if (!existing) {
          await db.customer.create({
            data: { name: c.name, harvestClientId: c.id },
          });
        }
      }
    } catch (err) {
      if (err instanceof HarvestAuthError) {
        status = TrackerConnectionStatus.auth_failed;
        topLevelError = 'Harvest auth failed; refresh credentials';
      } else {
        console.error('[SyncEngine.syncHarvestConnection] listClients', err);
      }
    }

    // Step 2 — upsert harvest_projects metadata (name, is_billable, url, customer).
    // We only insert a row when a matching Customer already exists; otherwise the
    // project is held back until an admin maps its customer via /trackers.
    let upsertableProjectIds: string[] = [];
    if (status === TrackerConnectionStatus.ok) {
      try {
        const projects = await adapter.listHarvestProjectsWithCustomer();
        for (const hp of projects) {
          const customer = await db.customer.findUnique({
            where: { harvestClientId: hp.clientId },
          });
          if (!customer) continue;
          await db.harvestProject.upsert({
            where: { id: hp.id },
            update: {
              name: hp.name,
              isBillable: hp.isBillable,
              harvestProjectUrl: hp.url,
              customerId: customer.id,
            },
            create: {
              id: hp.id,
              name: hp.name,
              customerId: customer.id,
              isBillable: hp.isBillable,
              harvestProjectUrl: hp.url,
            },
          });
          upsertableProjectIds.push(hp.id);
        }
      } catch (err) {
        if (err instanceof HarvestAuthError) {
          status = TrackerConnectionStatus.auth_failed;
          topLevelError = 'Harvest auth failed; refresh credentials';
        } else {
          console.error('[SyncEngine.syncHarvestConnection] listProjects', err);
        }
      }
    }

    // Step 3 — refresh per-project snapshots (budget, spent, breakdown) for every
    // harvest_projects row we have, batched to be polite about rate limits.
    //
    // We fetch the project-budget report ONCE (Harvest's `/reports/project_budget`
    // endpoint returns every active project's row), then pass each project's row
    // into `getProjectSnapshot` so it doesn't re-scan the full report per project.
    // Without this we burned through the rate limit ~N× over.
    let patched = 0;
    if (status === TrackerConnectionStatus.ok) {
      let budgetReportMap: Awaited<ReturnType<HarvestAdapter['listBudgetReportByProjectId']>>;
      try {
        budgetReportMap = await adapter.listBudgetReportByProjectId();
      } catch (err) {
        if (err instanceof HarvestAuthError) {
          status = TrackerConnectionStatus.auth_failed;
          topLevelError = 'Harvest auth failed; refresh credentials';
        } else {
          console.error('[SyncEngine.syncHarvestConnection] listBudgetReport', err);
        }
        budgetReportMap = new Map();
      }

      // Side-channel: collect every project's time entries so the tail-of-sync
      // 30-day aggregation can bucket by user without a second Harvest fetch.
      const hoursByUserId = new Map<string, number>();
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const rows = await db.harvestProject.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      for (let i = 0; i < rows.length && status === TrackerConnectionStatus.ok; i += HARVEST_BATCH_SIZE) {
        const batch = rows.slice(i, i + HARVEST_BATCH_SIZE);
        for (const row of batch) {
          try {
            const { snapshot, raw } = await adapter.getProjectSnapshot(
              row.id,
              budgetReportMap.get(row.id) ?? null,
            );
            await db.harvestProject.update({
              where: { id: row.id },
              data: {
                fetchedAt: new Date(snapshot.fetchedAt),
                budgetHours: snapshot.budgetHours === null ? null : new Prisma.Decimal(snapshot.budgetHours),
                spentHoursBillable: new Prisma.Decimal(snapshot.spentHoursBillable),
                spentHoursNonbillable: new Prisma.Decimal(snapshot.spentHoursNonbillable),
                breakdown: snapshot.breakdown as Prisma.InputJsonValue,
                harvestProjectUrl: snapshot.harvestProjectUrl,
                raw: (raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              },
            });
            patched += 1;

            // Bucket time entries by user.id for the 30d rollup (Step 4 below).
            const rawObj = raw as { timeEntries?: Array<{ spent_date?: string; hours?: number; user?: { id?: number } }> } | null;
            for (const entry of rawObj?.timeEntries ?? []) {
              const userId = entry.user?.id;
              if (userId === undefined) continue;
              const spent = entry.spent_date ? new Date(entry.spent_date) : null;
              if (!spent || Number.isNaN(spent.getTime()) || spent < cutoff) continue;
              const key = String(userId);
              hoursByUserId.set(key, (hoursByUserId.get(key) ?? 0) + (entry.hours ?? 0));
            }
          } catch (err) {
            if (err instanceof HarvestAuthError) {
              status = TrackerConnectionStatus.auth_failed;
              topLevelError = 'Harvest auth failed; refresh credentials';
              break;
            }
            if (err instanceof HarvestRateLimitError) {
              console.warn('[SyncEngine.syncHarvestConnection] rate-limited on', row.id);
              continue;
            }
            console.error('[SyncEngine.syncHarvestConnection] per-project error', {
              harvestProjectId: row.id,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        if (status !== TrackerConnectionStatus.ok) break;
        if (i + HARVEST_BATCH_SIZE < rows.length) {
          await new Promise((resolve) => setTimeout(resolve, HARVEST_BATCH_WAIT_MS));
        }
      }

      // Step 4 — tail-of-sync 30-day billed-hours rollup per Person. Uses the
      // time entries we already collected during the per-project loop; no new
      // Harvest API calls. Errors here are logged but don't fail the sync.
      try {
        const linkedPeople = await db.person.findMany({
          where: { harvestUserId: { not: null } },
          select: { id: true, harvestUserId: true },
        });
        for (const person of linkedPeople) {
          if (!person.harvestUserId) continue;
          const total = hoursByUserId.get(person.harvestUserId) ?? 0;
          await db.person.update({
            where: { id: person.id },
            data: {
              billedHoursLast30d: new Prisma.Decimal(total.toFixed(2)),
              billedHoursAsOf: syncedAt,
            },
          });
        }
      } catch (err) {
        console.error('[SyncEngine.syncHarvestConnection] 30d rollup', err);
      }
    }

    // Suppress unused-var lint when no follow-up needs `upsertableProjectIds`.
    void upsertableProjectIds;

    await db.trackerConnection.update({
      where: { id: connection.id },
      data: { status, lastSyncedAt: syncedAt },
    });

    const totalScanned = await db.harvestProject.count();

    return {
      connectionId: connection.id,
      status,
      syncedAt,
      projectsScanned: totalScanned,
      projectsPatched: patched,
      ...(topLevelError ? { error: topLevelError } : {}),
    };
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
