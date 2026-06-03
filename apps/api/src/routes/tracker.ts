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
import { HarvestAdapter } from '../sync/harvest/HarvestAdapter.js';
import type { ExternalProject } from '@torii/shared';

const MONDAY_AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
const MONDAY_TOKEN_URL = 'https://auth.monday.com/oauth2/token';
const OAUTH_STATE_COOKIE = 'torii_monday_oauth';
const MONDAY_OAUTH_SCOPE = 'boards:read me:read';

const HARVEST_AUTHORIZE_URL = 'https://id.getharvest.com/oauth2/authorize';
const HARVEST_TOKEN_URL = 'https://id.getharvest.com/api/v2/oauth2/token';
const HARVEST_OAUTH_STATE_COOKIE = 'torii_harvest_oauth';

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

interface HarvestTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * Exchange a Harvest refresh token for a new access token (and possibly a new refresh
 * token). Persists the encrypted result on the TrackerConnection row. Returns the new
 * access token so the caller can immediately retry the failed request.
 *
 * Wrap any adapter call that throws `HarvestAuthError` with a single retry through this
 * helper. Never log the access token, refresh token, or full response body.
 */
async function refreshHarvestAccessToken(
  db: DB,
  env: Env,
  connectionId: string,
): Promise<string> {
  const conn = await db.trackerConnection.findUnique({ where: { id: connectionId } });
  if (!conn) throw new NotFoundError('TrackerConnection not found');
  if (conn.provider !== TrackerProvider.harvest) {
    throw new ValidationError('refreshHarvestAccessToken called on a non-Harvest connection');
  }
  if (!conn.refreshTokenEnc) {
    throw new ValidationError('No refresh token available; re-authorize via /api/tracker/harvest/connect');
  }
  const refreshToken = decryptToken(conn.refreshTokenEnc, env.TRACKER_TOKEN_KEY);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: env.HARVEST_CLIENT_ID,
    client_secret: env.HARVEST_CLIENT_SECRET,
  });
  const res = await fetch(HARVEST_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    await db.trackerConnection.update({
      where: { id: connectionId },
      data: { status: 'auth_failed' },
    });
    throw new ValidationError(`Harvest token refresh failed: HTTP ${res.status}`);
  }
  const token = (await res.json()) as HarvestTokenResponse;
  if (!token.access_token) {
    throw new ValidationError('Harvest refresh returned no access_token');
  }
  await db.trackerConnection.update({
    where: { id: connectionId },
    data: {
      accessTokenEnc: encryptToken(token.access_token, env.TRACKER_TOKEN_KEY),
      ...(token.refresh_token
        ? { refreshTokenEnc: encryptToken(token.refresh_token, env.TRACKER_TOKEN_KEY) }
        : {}),
      status: 'ok',
    },
  });
  return token.access_token;
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

  function assertHarvestConfig(): void {
    if (!env.HARVEST_CLIENT_ID || !env.HARVEST_CLIENT_SECRET || !env.HARVEST_REDIRECT_URI) {
      throw new ForbiddenError('Harvest OAuth is not configured');
    }
    if (!env.TRACKER_TOKEN_KEY || !/^[0-9a-fA-F]{64}$/.test(env.TRACKER_TOKEN_KEY)) {
      throw new ForbiddenError('TRACKER_TOKEN_KEY must be 64 hex characters (32 bytes)');
    }
  }

  app.get('/api/tracker/harvest/connect', async (request, reply) => {
    requireAdmin(request);
    assertHarvestConfig();
    const state = crypto.randomUUID();
    reply.setCookie(HARVEST_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 10,
      signed: true,
    });
    const url = new URL(HARVEST_AUTHORIZE_URL);
    url.searchParams.set('client_id', env.HARVEST_CLIENT_ID);
    url.searchParams.set('redirect_uri', env.HARVEST_REDIRECT_URI);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    reply.redirect(url.toString());
  });

  app.get('/api/tracker/harvest/callback', async (request, reply) => {
    requireAdmin(request);
    assertHarvestConfig();
    const q = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);

    const raw = request.cookies[HARVEST_OAUTH_STATE_COOKIE];
    if (!raw) throw new ValidationError('Missing OAuth state cookie');
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value !== q.state) {
      throw new ValidationError('Invalid OAuth state');
    }
    reply.clearCookie(HARVEST_OAUTH_STATE_COOKIE, { path: '/' });

    // Exchange code for tokens. We deliberately don't log the response body — it
    // carries the access token, refresh token, and scope (which includes the
    // account ID). Only error categories are logged.
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env.HARVEST_CLIENT_ID,
      client_secret: env.HARVEST_CLIENT_SECRET,
      code: q.code,
      redirect_uri: env.HARVEST_REDIRECT_URI,
    });
    const tokenRes = await fetch(HARVEST_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    if (!tokenRes.ok) {
      throw new ValidationError(`Harvest token exchange failed: HTTP ${tokenRes.status}`);
    }
    const token = (await tokenRes.json()) as HarvestTokenResponse;
    if (!token.access_token) throw new ValidationError('Harvest returned no access_token');

    // Discover the account ID via `GET id.getharvest.com/api/v2/accounts`. This is the
    // canonical Harvest pattern — the OAuth response doesn't reliably encode the account
    // ID in `scope`, so we ask Harvest directly. Authenticated with just the bearer token
    // (no Harvest-Account-Id header, since we don't know it yet).
    const accountsRes = await fetch('https://id.getharvest.com/api/v2/accounts', {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
        'User-Agent': 'Torii (PortX delivery dashboard)',
      },
    });
    if (!accountsRes.ok) {
      throw new ValidationError(`Harvest accounts lookup failed: HTTP ${accountsRes.status}`);
    }
    const accountsBody = (await accountsRes.json()) as {
      user?: { id?: number; first_name?: string; last_name?: string; email?: string };
      accounts?: Array<{ id: number; name: string; product?: string }>;
    };
    // Prefer Harvest-product accounts (the user may also belong to a Forecast account).
    const harvestAccount =
      (accountsBody.accounts ?? []).find((a) => a.product === 'harvest') ??
      (accountsBody.accounts ?? [])[0];
    if (!harvestAccount) {
      throw new ValidationError(
        'No Harvest account is accessible to this token. Confirm the OAuth app is configured for Harvest (not Forecast) and re-authorize.',
      );
    }
    const accountId = String(harvestAccount.id);
    const me = accountsBody.user ?? {};

    // Capture the workspace subdomain from `/v2/company` for building project URLs
    // in the HarvestPanel. Falls back to `account-<id>` when not available.
    const companyRes = await fetch('https://api.harvestapp.com/v2/company', {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Harvest-Account-Id': accountId,
        Accept: 'application/json',
      },
    });
    let workspace = `account-${accountId}`;
    if (companyRes.ok) {
      const company = (await companyRes.json()) as { full_domain?: string; base_uri?: string; subdomain?: string };
      // Prefer subdomain (e.g., "portx") if available; fall back to full_domain.
      workspace = company.subdomain ?? company.full_domain ?? workspace;
    }

    await db.trackerConnection.upsert({
      where: {
        provider_workspace: { provider: TrackerProvider.harvest, workspace },
      },
      update: {
        accessTokenEnc: encryptToken(token.access_token, env.TRACKER_TOKEN_KEY),
        refreshTokenEnc: token.refresh_token ? encryptToken(token.refresh_token, env.TRACKER_TOKEN_KEY) : null,
        harvestAccountId: accountId,
        status: 'ok',
      },
      create: {
        provider: TrackerProvider.harvest,
        workspace,
        accessTokenEnc: encryptToken(token.access_token, env.TRACKER_TOKEN_KEY),
        refreshTokenEnc: token.refresh_token ? encryptToken(token.refresh_token, env.TRACKER_TOKEN_KEY) : null,
        harvestAccountId: accountId,
        status: 'ok',
      },
    });

    app.log.info(
      {
        provider: 'harvest',
        workspace,
        userEmail: me.email ?? null,
        accountId,
      },
      'Harvest connection persisted',
    );

    reply.redirect(`${env.WEB_BASE_URL}/trackers`);
  });

  /**
   * List Harvest projects with their current Torii link state. Powers the bulk-link
   * UI on /trackers. Admin-only since linking is admin-only.
   */
  app.get('/api/tracker/harvest/projects', async (request, reply) => {
    requireAdmin(request);
    const conn = await db.trackerConnection.findFirst({
      where: { provider: TrackerProvider.harvest },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!conn) throw new NotFoundError('No active Harvest connection');
    if (!conn.harvestAccountId) {
      throw new ValidationError('Harvest connection is missing account ID; re-authorize');
    }
    const accessToken = decryptToken(conn.accessTokenEnc, env.TRACKER_TOKEN_KEY);
    const adapter = getAdapterFactory(TrackerProvider.harvest)({
      workspace: conn.workspace,
      accessToken,
      accountId: conn.harvestAccountId,
    });

    let externals: ExternalProject[];
    try {
      externals = await adapter.listProjects();
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      if (errName === 'HarvestRateLimitError') {
        reply.code(429);
        return { error: 'Harvest rate-limited; retry in 15s' };
      }
      throw err;
    }

    // Join: for each Harvest project, look up the cached `harvest_projects` row to find
    // its pinned Torii project (if any). The cached row is authoritative since the new
    // model puts the link on the Harvest-project side, not the Torii-project side.
    const cached = await db.harvestProject.findMany({
      where: { id: { in: externals.map((e) => e.externalId) } },
      include: { project: { select: { id: true, name: true } } },
    });
    const cachedById = new Map(cached.map((hp) => [hp.id, hp]));

    return externals.map((e) => {
      const hp = cachedById.get(e.externalId);
      return {
        harvestProjectId: e.externalId,
        name: e.name ?? '',
        linkedToiriProjectId: hp?.project?.id ?? null,
        linkedToiriProjectName: hp?.project?.name ?? null,
      };
    });
  });

  /**
   * List Harvest users joined with their current Torii Person link state. Admin-only
   * since linking is admin-only. Powers the user-link table on /trackers that
   * populates `Person.harvest_user_id` (the bridge needed by the reconciliation views).
   */
  app.get('/api/tracker/harvest/users', async (request, reply) => {
    requireAdmin(request);
    const conn = await db.trackerConnection.findFirst({
      where: { provider: TrackerProvider.harvest },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!conn) throw new NotFoundError('No active Harvest connection');
    if (!conn.harvestAccountId) {
      throw new ValidationError('Harvest connection is missing account ID; re-authorize');
    }
    const accessToken = decryptToken(conn.accessTokenEnc, env.TRACKER_TOKEN_KEY);
    const adapter = new HarvestAdapter({
      workspace: conn.workspace,
      accessToken,
      accountId: conn.harvestAccountId,
    });

    let users: Array<{ id: string; name: string; email: string }>;
    try {
      users = await adapter.listUsers();
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      if (errName === 'HarvestRateLimitError') {
        reply.code(429);
        return { error: 'Harvest rate-limited; retry in 15s' };
      }
      throw err;
    }

    // Join: for each Harvest user, find any Torii Person currently linked to that id.
    const linked = await db.person.findMany({
      where: { harvestUserId: { in: users.map((u) => u.id) } },
      select: { id: true, name: true, harvestUserId: true },
    });
    const linkedByHarvestId = new Map(linked.map((p) => [p.harvestUserId, p]));

    return users.map((u) => {
      const link = linkedByHarvestId.get(u.id);
      return {
        harvestUserId: u.id,
        name: u.name,
        email: u.email,
        linkedToiriPersonId: link?.id ?? null,
        linkedToiriPersonName: link?.name ?? null,
      };
    });
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

  /**
   * List every active Harvest client, joined to local customer state. Powers the
   * customer-link table on /trackers.
   */
  app.get('/api/tracker/harvest/clients', async (request, reply) => {
    requireAdmin(request);
    const conn = await db.trackerConnection.findFirst({
      where: { provider: TrackerProvider.harvest },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!conn) throw new NotFoundError('No active Harvest connection');
    if (!conn.harvestAccountId) {
      throw new ValidationError('Harvest connection is missing account ID; re-authorize');
    }
    const accessToken = decryptToken(conn.accessTokenEnc, env.TRACKER_TOKEN_KEY);
    const adapter = new HarvestAdapter({
      workspace: conn.workspace,
      accessToken,
      accountId: conn.harvestAccountId,
    });

    let clients;
    try {
      clients = await adapter.listClients();
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      if (errName === 'HarvestRateLimitError') {
        reply.code(429);
        return { error: 'Harvest rate-limited; retry in 15s' };
      }
      throw err;
    }

    const linked = await db.customer.findMany({
      where: { harvestClientId: { in: clients.map((c) => c.id) } },
      select: { id: true, name: true, harvestClientId: true },
    });
    const linkedByHarvestId = new Map(linked.map((c) => [c.harvestClientId, c]));

    return clients.map((c) => {
      const localCustomer = linkedByHarvestId.get(c.id);
      return {
        harvestClientId: c.id,
        name: c.name,
        linkedToiriCustomerId: localCustomer?.id ?? null,
        linkedToiriCustomerName: localCustomer?.name ?? null,
      };
    });
  });

  const pinBody = z.object({ toriiProjectId: z.string().min(1) });

  /**
   * Pin a Harvest project to a Torii project. Enforces that the Torii project's
   * customer matches the Harvest project's customer.
   */
  app.post('/api/tracker/harvest/projects/:harvestProjectId/pin', async (request) => {
    requireAdmin(request);
    const { harvestProjectId } = z
      .object({ harvestProjectId: z.string().min(1) })
      .parse(request.params);
    const { toriiProjectId } = pinBody.parse(request.body);

    const hp = await db.harvestProject.findUnique({ where: { id: harvestProjectId } });
    if (!hp) throw new NotFoundError('Harvest project not found');

    const torii = await db.project.findUnique({ where: { id: toriiProjectId } });
    if (!torii) throw new NotFoundError('Torii project not found');

    if (torii.customerId !== hp.customerId) {
      throw new ValidationError(
        'Pin failed: the Torii project and the Harvest project must belong to the same customer',
      );
    }

    await db.harvestProject.update({
      where: { id: harvestProjectId },
      data: { projectId: toriiProjectId },
    });
    return { ok: true };
  });

  app.delete('/api/tracker/harvest/projects/:harvestProjectId/pin', async (request, reply) => {
    requireAdmin(request);
    const { harvestProjectId } = z
      .object({ harvestProjectId: z.string().min(1) })
      .parse(request.params);
    const hp = await db.harvestProject.findUnique({ where: { id: harvestProjectId } });
    if (!hp) throw new NotFoundError('Harvest project not found');
    await db.harvestProject.update({
      where: { id: harvestProjectId },
      data: { projectId: null },
    });
    reply.code(204);
    return null;
  });
}
