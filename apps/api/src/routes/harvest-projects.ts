import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, TrackerProvider, TrackerConnectionStatus } from '@prisma/client';
import {
  HarvestSnapshotSchema,
  NotFoundError,
  ValidationError,
  type HarvestSnapshot,
} from '@torii/shared';
import type { DB } from '../db.js';
import type { Env } from '../env.js';
import { requireAdmin, requirePM, requireUser } from '../plugins/guards.js';
import { decryptToken, encryptToken } from '../sync/encryption.js';
import { HarvestAdapter, HarvestAuthError, HarvestRateLimitError } from '../sync/harvest/HarvestAdapter.js';

const idParams = z.object({ id: z.string().min(1) });
const linkBody = z.object({ harvestProjectId: z.string().min(1) });

interface RegisterHarvestProjectsOptions {
  db: DB;
  env: Env;
}

/**
 * Resolve the active Harvest connection, decrypt credentials, and return a constructed
 * HarvestAdapter. Throws ValidationError(404) when no connection exists.
 *
 * The returned `connectionId` is needed for token-refresh on auth failure.
 */
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

/**
 * Run a Harvest adapter call, retrying with a freshly refreshed access token if the
 * first attempt fails with `HarvestAuthError`. Surfaces rate-limit errors unchanged
 * so the route can map them to 429.
 */
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

/**
 * Inline version of the helper from tracker.ts. Duplicated here to keep the file
 * self-contained; both call sites use the same encryption key.
 */
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

export function registerHarvestProjectsRoutes(
  app: FastifyInstance,
  opts: RegisterHarvestProjectsOptions,
): void {
  const { db, env } = opts;

  // POST /api/projects/:id/harvest/link - admin only
  app.post('/api/projects/:id/harvest/link', async (request, reply) => {
    requireAdmin(request);
    const { id } = idParams.parse(request.params);
    const { harvestProjectId } = linkBody.parse(request.body);

    const project = await db.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundError('Project not found');

    // Reject when the same Harvest project is already linked to a different Torii project.
    const conflict = await db.project.findFirst({
      where: { harvestProjectId, id: { not: id } },
    });
    if (conflict) {
      throw new ValidationError(
        `Harvest project ${harvestProjectId} is already linked to another Torii project`,
      );
    }

    // Validate the Harvest project exists by calling getProject().
    const ctx = await resolveHarvestContext(db);
    let external;
    try {
      external = await withHarvestRetry(db, env, ctx, (a) => a.getProject(harvestProjectId));
    } catch (err) {
      if (err instanceof HarvestRateLimitError) {
        reply.code(429);
        return { error: 'Harvest rate-limited; retry in 15s' };
      }
      throw err;
    }
    if (!external) {
      throw new ValidationError(`Harvest project ${harvestProjectId} not found`);
    }

    await db.project.update({
      where: { id },
      data: { harvestProjectId },
    });
    return { ok: true };
  });

  // DELETE /api/projects/:id/harvest/link - admin only
  app.delete('/api/projects/:id/harvest/link', async (request, reply) => {
    requireAdmin(request);
    const { id } = idParams.parse(request.params);

    const project = await db.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundError('Project not found');

    await db.$transaction(async (tx) => {
      await tx.projectHarvestSnapshot.deleteMany({ where: { projectId: id } });
      await tx.project.update({ where: { id }, data: { harvestProjectId: null } });
    });
    reply.code(204);
    return null;
  });

  // POST /api/projects/:id/harvest/refresh - PM or higher
  app.post('/api/projects/:id/harvest/refresh', async (request, reply) => {
    requirePM(request);
    const { id } = idParams.parse(request.params);

    const project = await db.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundError('Project not found');
    if (!project.harvestProjectId) {
      throw new NotFoundError('Project is not linked to a Harvest project');
    }

    const ctx = await resolveHarvestContext(db);
    let result;
    try {
      result = await withHarvestRetry(db, env, ctx, (a) =>
        a.getProjectSnapshot(project.harvestProjectId!),
      );
    } catch (err) {
      if (err instanceof HarvestRateLimitError) {
        reply.code(429);
        return { error: 'Harvest rate-limited; retry in 15s' };
      }
      throw err;
    }

    const projected: HarvestSnapshot = {
      ...result.snapshot,
      projectId: id,
    };

    await db.projectHarvestSnapshot.upsert({
      where: { projectId: id },
      update: {
        fetchedAt: new Date(projected.fetchedAt),
        budgetHours: projected.budgetHours === null ? null : new Prisma.Decimal(projected.budgetHours),
        spentHoursBillable: new Prisma.Decimal(projected.spentHoursBillable),
        spentHoursNonbillable: new Prisma.Decimal(projected.spentHoursNonbillable),
        breakdown: projected.breakdown as Prisma.InputJsonValue,
        raw: (result.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
      create: {
        projectId: id,
        fetchedAt: new Date(projected.fetchedAt),
        budgetHours: projected.budgetHours === null ? null : new Prisma.Decimal(projected.budgetHours),
        spentHoursBillable: new Prisma.Decimal(projected.spentHoursBillable),
        spentHoursNonbillable: new Prisma.Decimal(projected.spentHoursNonbillable),
        breakdown: projected.breakdown as Prisma.InputJsonValue,
        raw: (result.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });

    return projected;
  });

  // GET /api/projects/:id/harvest - any authenticated user
  app.get('/api/projects/:id/harvest', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);

    const project = await db.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundError('Project not found');
    if (!project.harvestProjectId) {
      throw new NotFoundError('Project is not linked to a Harvest project');
    }

    const row = await db.projectHarvestSnapshot.findUnique({ where: { projectId: id } });
    if (!row) {
      throw new NotFoundError('Snapshot not yet fetched — refresh first');
    }

    // Pull the workspace from the connection so we can build the Harvest project URL.
    const conn = await db.trackerConnection.findFirst({
      where: { provider: TrackerProvider.harvest },
      orderBy: { lastSyncedAt: 'desc' },
    });
    const workspace = conn?.workspace ?? 'app';

    const snapshot: HarvestSnapshot = HarvestSnapshotSchema.parse({
      projectId: id,
      fetchedAt: row.fetchedAt.toISOString(),
      harvestProjectId: project.harvestProjectId,
      harvestProjectUrl: `https://${workspace}.harvestapp.com/projects/${project.harvestProjectId}`,
      budgetHours: row.budgetHours === null ? null : Number(row.budgetHours),
      spentHoursBillable: Number(row.spentHoursBillable),
      spentHoursNonbillable: Number(row.spentHoursNonbillable),
      breakdown: row.breakdown as HarvestSnapshot['breakdown'],
    });
    return snapshot;
  });
}
