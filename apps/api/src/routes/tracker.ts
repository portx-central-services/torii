import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, TrackerProvider } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '@torii/shared';
import type { DB } from '../db.js';
import type { Env } from '../env.js';
import { requireAdmin, requirePM, requireUser } from '../plugins/guards.js';
import { decryptToken, encryptToken } from '../sync/encryption.js';
import type { SyncEngine } from '../sync/engine.js';
import { getAdapterFactory } from '../sync/registry.js';
import type { ExternalProject } from '@torii/shared';

const MONDAY_AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
const MONDAY_TOKEN_URL = 'https://auth.monday.com/oauth2/token';
const OAUTH_STATE_COOKIE = 'torii_monday_oauth';
const MONDAY_OAUTH_SCOPE = 'boards:read me:read';

const idParams = z.object({ id: z.string().min(1) });

const importBody = z.object({
  externalIds: z.array(z.string().min(1)).min(1),
  overwrite: z.boolean().optional(),
});

interface MondayTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
}

interface RegisterTrackerOptions {
  db: DB;
  env: Env;
  engine: SyncEngine;
}

function assertMondayConfig(env: Env): void {
  if (!env.MONDAY_CLIENT_ID || !env.MONDAY_CLIENT_SECRET || !env.MONDAY_REDIRECT_URI) {
    throw new ForbiddenError('Monday.com is not configured');
  }
  if (!env.TRACKER_TOKEN_KEY) {
    throw new ForbiddenError(
      'TRACKER_TOKEN_KEY is required for Monday token encryption. Generate one with: openssl rand -hex 32',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(env.TRACKER_TOKEN_KEY)) {
    throw new ForbiddenError('TRACKER_TOKEN_KEY must be 64 hex characters (32 bytes)');
  }
}

export function registerTrackerRoutes(
  app: FastifyInstance,
  opts: RegisterTrackerOptions,
): void {
  const { db, env, engine } = opts;

  app.get('/api/tracker/connections', async (request) => {
    requireUser(request);
    const conns = await db.trackerConnection.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        workspace: true,
        status: true,
        lastSyncedAt: true,
        createdAt: true,
      },
    });
    return conns.map((c) => ({
      id: c.id,
      provider: c.provider,
      workspace: c.workspace,
      status: c.status,
      lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
  });

  app.get('/api/tracker/monday/connect', async (request, reply) => {
    requireAdmin(request);
    assertMondayConfig(env);
    const state = crypto.randomUUID();
    reply.setCookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 10,
      signed: true,
    });
    const url = new URL(MONDAY_AUTHORIZE_URL);
    url.searchParams.set('client_id', env.MONDAY_CLIENT_ID);
    url.searchParams.set('redirect_uri', env.MONDAY_REDIRECT_URI);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', MONDAY_OAUTH_SCOPE);
    reply.redirect(url.toString());
  });

  app.get('/api/tracker/monday/callback', async (request, reply) => {
    requireAdmin(request);
    assertMondayConfig(env);
    const q = z
      .object({
        code: z.string().min(1),
        state: z.string().min(1),
      })
      .parse(request.query);

    const raw = request.cookies[OAUTH_STATE_COOKIE];
    if (!raw) throw new ValidationError('Missing OAuth state cookie');
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value !== q.state) {
      throw new ValidationError('Invalid OAuth state');
    }
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

    // Exchange code for token
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.MONDAY_CLIENT_ID,
      client_secret: env.MONDAY_CLIENT_SECRET,
      code: q.code,
      redirect_uri: env.MONDAY_REDIRECT_URI,
    });
    const tokenRes = await fetch(MONDAY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenRes.ok) {
      throw new ValidationError(`Monday token exchange failed: HTTP ${tokenRes.status}`);
    }
    const token = (await tokenRes.json()) as MondayTokenResponse;
    if (!token.access_token) throw new ValidationError('Monday returned no access_token');

    await db.trackerConnection.upsert({
      where: {
        provider_workspace: { provider: TrackerProvider.monday, workspace: 'default' },
      },
      update: {
        accessTokenEnc: encryptToken(token.access_token, env.TRACKER_TOKEN_KEY),
        refreshTokenEnc: token.refresh_token
          ? encryptToken(token.refresh_token, env.TRACKER_TOKEN_KEY)
          : null,
        status: 'ok',
      },
      create: {
        provider: TrackerProvider.monday,
        workspace: 'default',
        accessTokenEnc: encryptToken(token.access_token, env.TRACKER_TOKEN_KEY),
        refreshTokenEnc: token.refresh_token
          ? encryptToken(token.refresh_token, env.TRACKER_TOKEN_KEY)
          : null,
        status: 'ok',
      },
    });

    reply.redirect(`${env.WEB_BASE_URL}/trackers`);
  });

  app.post('/api/tracker/connections/:id/refresh', async (request) => {
    requirePM(request);
    const { id } = idParams.parse(request.params);
    const rawBody = request.body && typeof request.body === 'object' ? request.body : {};
    const { force } = z.object({ force: z.boolean().optional() }).parse(rawBody);
    const conn = await db.trackerConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundError('TrackerConnection not found');
    const result = await engine.syncConnection(id, { force });
    return result;
  });

  app.post('/api/tracker/projects/:id/refresh', async (request) => {
    requirePM(request);
    const { id } = idParams.parse(request.params);
    const project = await db.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundError('Project not found');
    const result = await engine.syncProject(id);
    if (!result) {
      throw new ValidationError('Project is not linked to a tracker');
    }
    return result;
  });

  app.post('/api/tracker/connections/:id/import', async (request) => {
    requirePM(request);
    const { id } = idParams.parse(request.params);
    const { externalIds, overwrite = false } = importBody.parse(request.body);
    const conn = await db.trackerConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundError('TrackerConnection not found');

    const created: Array<{ id: string; externalId: string }> = [];
    const updated: Array<{ id: string; externalId: string }> = [];
    const skipped: string[] = [];
    const placeholdered: string[] = [];

    const accessToken = decryptToken(conn.accessTokenEnc, env.TRACKER_TOKEN_KEY);
    const adapter = getAdapterFactory(conn.provider)({
      workspace: conn.workspace,
      accessToken,
    });

    const existingProjects = await db.project.findMany({
      where: { trackerRef: { not: Prisma.JsonNull } },
    });

    for (const externalId of externalIds) {
      const matching = existingProjects.find((p) => {
        const ref = p.trackerRef as { provider?: string; externalId?: string } | null;
        return ref?.provider === conn.provider && ref?.externalId === externalId;
      });
      if (matching && !overwrite) {
        skipped.push(externalId);
        continue;
      }

      let external: ExternalProject | null = null;
      try {
        external = await adapter.getProject(externalId);
        if (!external) {
          app.log.warn(
            { connectionId: id, externalId, provider: conn.provider },
            'Tracker import: adapter returned no project; using placeholder name',
          );
        }
      } catch (err) {
        app.log.error(
          {
            err,
            connectionId: id,
            externalId,
            provider: conn.provider,
          },
          'Tracker import: failed to fetch external project; using placeholder name',
        );
      }

      const name = external?.name ?? `Monday item ${externalId}`;
      const newKeyDateFields: Record<string, string> = { ...(external?.keyDates ?? {}) };
      const newDetailFields = external?.details ?? {};
      const externalPhase = external?.phase;
      if (!external?.name) placeholdered.push(externalId);

      const trackerRawValue = (external?.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue;

      if (matching) {
        const mergedKeyDates = {
          ...((matching.keyDates as Record<string, string | undefined>) ?? {}),
          ...newKeyDateFields,
        };
        const mergedDetails = {
          ...((matching.details as Record<string, string | undefined>) ?? {}),
          ...newDetailFields,
        };
        const project = await db.project.update({
          where: { id: matching.id },
          data: {
            name,
            ...(externalPhase ? { phase: externalPhase } : {}),
            keyDates: mergedKeyDates,
            details: mergedDetails,
            trackerRaw: trackerRawValue,
          },
        });
        updated.push({ id: project.id, externalId });
      } else {
        const project = await db.project.create({
          data: {
            name,
            ...(externalPhase ? { phase: externalPhase } : {}),
            trackerRef: { provider: conn.provider, externalId },
            // Empty per-project mapping — the merge engine falls through to
            // `DEFAULT_FIELD_MAPPING` for unspecified keys. Snapshotting the
            // full default here would re-introduce the stale-ownership bug
            // (see migration 20260530120000): a key whose default later flips
            // would stay pinned on every old row. Per-project overrides
            // (e.g., PM pinning phase to torii) live here when actually set.
            fieldMapping: {},
            trackerRaw: trackerRawValue,
            ...(Object.keys(newKeyDateFields).length > 0 ? { keyDates: newKeyDateFields } : {}),
            ...(Object.keys(newDetailFields).length > 0 ? { details: newDetailFields } : {}),
          },
        });
        created.push({ id: project.id, externalId });
      }
    }

    app.log.info(
      {
        connectionId: id,
        overwrite,
        importedRequested: externalIds.length,
        importedCreated: created.length,
        importedUpdated: updated.length,
        importedSkipped: skipped.length,
        importedPlaceholdered: placeholdered.length,
        placeholderedExternalIds: placeholdered,
      },
      'Tracker import summary',
    );

    return { created, updated, skipped };
  });

  app.post('/api/tracker/connections/:id/test', async (request) => {
    requirePM(request);
    const { id } = idParams.parse(request.params);
    const conn = await db.trackerConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundError('TrackerConnection not found');

    const accessToken = decryptToken(conn.accessTokenEnc, env.TRACKER_TOKEN_KEY);
    const adapter = getAdapterFactory(conn.provider)({
      workspace: conn.workspace,
      accessToken,
    });

    const result = await adapter.verifyAccess();
    app.log.info(
      { connectionId: id, provider: conn.provider, ok: result.ok, probes: result.probes },
      'Tracker connection test',
    );
    return { connectionId: id, provider: conn.provider, ...result };
  });
}
