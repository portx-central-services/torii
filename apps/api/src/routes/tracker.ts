import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TrackerProvider } from '@prisma/client';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  DEFAULT_FIELD_MAPPING,
} from '@torii/shared';
import type { DB } from '../db.js';
import type { Env } from '../env.js';
import { requireAdmin, requirePM, requireUser } from '../plugins/guards.js';
import { encryptToken } from '../sync/encryption.js';
import type { SyncEngine } from '../sync/engine.js';

const MONDAY_AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
const MONDAY_TOKEN_URL = 'https://auth.monday.com/oauth2/token';
const OAUTH_STATE_COOKIE = 'torii_monday_oauth';

const idParams = z.object({ id: z.string().min(1) });

const importBody = z.object({
  externalIds: z.array(z.string().min(1)).min(1),
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
    if (!env.MONDAY_CLIENT_ID || !env.MONDAY_CLIENT_SECRET || !env.MONDAY_REDIRECT_URI) {
      throw new ForbiddenError('Monday.com is not configured');
    }
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
    reply.redirect(url.toString());
  });

  app.get('/api/tracker/monday/callback', async (request, reply) => {
    requireAdmin(request);
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
    const conn = await db.trackerConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundError('TrackerConnection not found');
    const result = await engine.syncConnection(id);
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
    const { externalIds } = importBody.parse(request.body);
    const conn = await db.trackerConnection.findUnique({ where: { id } });
    if (!conn) throw new NotFoundError('TrackerConnection not found');

    const created: Array<{ id: string; externalId: string }> = [];
    const skipped: string[] = [];

    for (const externalId of externalIds) {
      // Has a project already been linked for this provider+externalId?
      const existingProjects = await db.project.findMany({
        where: {},
      });
      const matching = existingProjects.find((p) => {
        const ref = p.trackerRef as { provider?: string; externalId?: string } | null;
        return ref?.provider === conn.provider && ref?.externalId === externalId;
      });
      if (matching) {
        skipped.push(externalId);
        continue;
      }
      const project = await db.project.create({
        data: {
          name: `Monday item ${externalId}`,
          trackerRef: { provider: conn.provider, externalId },
          fieldMapping: DEFAULT_FIELD_MAPPING,
        },
      });
      created.push({ id: project.id, externalId });
    }

    // Now run a per-project sync for the newly created ones to pull the real name etc.
    for (const c of created) {
      await engine.syncProject(c.id).catch(() => undefined);
    }

    return { created, skipped };
  });
}
