import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, TrackerProvider, TrackerConnectionStatus } from '@prisma/client';
import {
  HarvestProjectSnapshotSchema,
  NotFoundError,
  ValidationError,
  type HarvestProjectSnapshot,
} from '@torii/shared';
import type { DB } from '../db.js';
import type { Env } from '../env.js';
import { requirePM, requireUser } from '../plugins/guards.js';
import { decryptToken, encryptToken } from '../sync/encryption.js';
import { HarvestAdapter, HarvestAuthError, HarvestRateLimitError } from '../sync/harvest/HarvestAdapter.js';

const idParams = z.object({ id: z.string().min(1) });

interface RegisterHarvestProjectsOptions {
  db: DB;
  env: Env;
}

interface HarvestContext {
  connectionId: string;
  workspace: string;
  accountId: string;
}

async function resolveHarvestContext(db: DB): Promise<HarvestContext> {
  const conn = await db.trackerConnection.findFirst({
    where: {
      provider: TrackerProvider.harvest,
      status: { not: TrackerConnectionStatus.auth_failed },
    },
    orderBy: { lastSyncedAt: 'desc' },
  });
  if (!conn) throw new NotFoundError('No active Harvest connection');
  if (!conn.harvestAccountId) {
    throw new ValidationError('Harvest connection is missing account ID; re-authorize');
  }
  return { connectionId: conn.id, workspace: conn.workspace, accountId: conn.harvestAccountId };
}

async function withHarvestRetry<T>(
  db: DB,
  env: Env,
  ctx: HarvestContext,
  call: (adapter: HarvestAdapter) => Promise<T>,
): Promise<T> {
  const buildAdapter = (token: string): HarvestAdapter =>
    new HarvestAdapter({ workspace: ctx.workspace, accessToken: token, accountId: ctx.accountId });
  const conn = await db.trackerConnection.findUnique({ where: { id: ctx.connectionId } });
  if (!conn) throw new NotFoundError('TrackerConnection not found');
  const initialToken = decryptToken(conn.accessTokenEnc, env.TRACKER_TOKEN_KEY);
  try {
    return await call(buildAdapter(initialToken));
  } catch (err) {
    if (!(err instanceof HarvestAuthError)) throw err;
    const newToken = await refreshHarvestAccessTokenInline(db, env, ctx.connectionId);
    return await call(buildAdapter(newToken));
  }
}

async function refreshHarvestAccessTokenInline(
  db: DB,
  env: Env,
  connectionId: string,
): Promise<string> {
  const conn = await db.trackerConnection.findUnique({ where: { id: connectionId } });
  if (!conn?.refreshTokenEnc) {
    throw new ValidationError('No refresh token available; re-authorize via /api/tracker/harvest/connect');
  }
  const refreshToken = decryptToken(conn.refreshTokenEnc, env.TRACKER_TOKEN_KEY);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: env.HARVEST_CLIENT_ID,
    client_secret: env.HARVEST_CLIENT_SECRET,
  });
  const res = await fetch('https://id.getharvest.com/api/v2/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    await db.trackerConnection.update({
      where: { id: connectionId },
      data: { status: TrackerConnectionStatus.auth_failed },
    });
    throw new ValidationError(`Harvest token refresh failed: HTTP ${res.status}`);
  }
  const token = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!token.access_token) throw new ValidationError('Harvest refresh returned no access_token');
  await db.trackerConnection.update({
    where: { id: connectionId },
    data: {
      accessTokenEnc: encryptToken(token.access_token, env.TRACKER_TOKEN_KEY),
      ...(token.refresh_token
        ? { refreshTokenEnc: encryptToken(token.refresh_token, env.TRACKER_TOKEN_KEY) }
        : {}),
      status: TrackerConnectionStatus.ok,
    },
  });
  return token.access_token;
}

type HarvestProjectRow = {
  id: string;
  name: string;
  customerId: string;
  projectId: string | null;
  isBillable: boolean;
  harvestProjectUrl: string;
  budgetHours: Prisma.Decimal | null;
  spentHoursBillable: Prisma.Decimal;
  spentHoursNonbillable: Prisma.Decimal;
  breakdown: unknown;
  fetchedAt: Date;
};

function serializeHarvestProjectRow(row: HarvestProjectRow): HarvestProjectSnapshot {
  return HarvestProjectSnapshotSchema.parse({
    id: row.id,
    name: row.name,
    customerId: row.customerId,
    projectId: row.projectId,
    isBillable: row.isBillable,
    harvestProjectUrl: row.harvestProjectUrl,
    budgetHours: row.budgetHours === null ? null : Number(row.budgetHours),
    spentHoursBillable: Number(row.spentHoursBillable),
    spentHoursNonbillable: Number(row.spentHoursNonbillable),
    breakdown: row.breakdown as HarvestProjectSnapshot['breakdown'],
    fetchedAt: row.fetchedAt.toISOString(),
  });
}

/**
 * Sort pinned-billable first, then by name. The HarvestPanel renders in this order.
 */
function harvestProjectSortKey(a: HarvestProjectSnapshot, b: HarvestProjectSnapshot): number {
  if (a.isBillable !== b.isBillable) return a.isBillable ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export function registerHarvestProjectsRoutes(
  app: FastifyInstance,
  opts: RegisterHarvestProjectsOptions,
): void {
  const { db, env } = opts;

  /**
   * Read every pinned Harvest project for the given Torii project.
   * Returns an empty array (not 404) when no Harvest projects are pinned — callers
   * use the empty result to show the panel's empty state.
   */
  app.get('/api/projects/:id/harvest', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);

    const project = await db.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundError('Project not found');

    const rows = await db.harvestProject.findMany({ where: { projectId: id } });
    const harvestProjects = rows.map(serializeHarvestProjectRow).sort(harvestProjectSortKey);
    return { harvestProjects };
  });

  /**
   * Refresh every Harvest project pinned to this Torii project, in parallel.
   * PM or higher. Returns the refreshed array, same shape as GET.
   */
  app.post('/api/projects/:id/harvest/refresh', async (request, reply) => {
    requirePM(request);
    const { id } = idParams.parse(request.params);

    const project = await db.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundError('Project not found');

    const pinned = await db.harvestProject.findMany({ where: { projectId: id } });
    if (pinned.length === 0) {
      return { harvestProjects: [] };
    }

    const ctx = await resolveHarvestContext(db);

    // Fetch the project-budget report ONCE (it returns every active project's row)
    // and pass each project's pre-fetched row into `getProjectSnapshot`. Without
    // this, parallel refresh of 5 pinned Harvest projects = 5 full report scans,
    // which is the same rate-limit trap as the sync engine.
    //
    // Refresh sequentially to keep total request volume polite — parallel
    // `getProjectSnapshot` calls would still bunch time-entry page fetches.
    let refreshed: string[];
    try {
      const budgetReportMap = await withHarvestRetry(db, env, ctx, (a) =>
        a.listBudgetReportByProjectId(),
      );
      refreshed = [];
      for (const hp of pinned) {
        const result = await withHarvestRetry(db, env, ctx, (a) =>
          a.getProjectSnapshot(hp.id, budgetReportMap.get(hp.id) ?? null),
        );
        await db.harvestProject.update({
          where: { id: hp.id },
          data: {
            fetchedAt: new Date(result.snapshot.fetchedAt),
            budgetHours:
              result.snapshot.budgetHours === null ? null : new Prisma.Decimal(result.snapshot.budgetHours),
            spentHoursBillable: new Prisma.Decimal(result.snapshot.spentHoursBillable),
            spentHoursNonbillable: new Prisma.Decimal(result.snapshot.spentHoursNonbillable),
            breakdown: result.snapshot.breakdown as Prisma.InputJsonValue,
            harvestProjectUrl: result.snapshot.harvestProjectUrl,
            raw: (result.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          },
        });
        refreshed.push(hp.id);
      }
    } catch (err) {
      if (err instanceof HarvestRateLimitError) {
        reply.code(429);
        return { error: 'Harvest rate-limited; retry in 15s' };
      }
      throw err;
    }

    const updatedRows = await db.harvestProject.findMany({ where: { id: { in: refreshed } } });
    const harvestProjects = updatedRows.map(serializeHarvestProjectRow).sort(harvestProjectSortKey);
    return { harvestProjects };
  });
}
