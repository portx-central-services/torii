import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSessionHook } from './plugins/session.js';
import { registerAuthRoutes } from './routes/auth/index.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerPeopleRoutes } from './routes/people.js';
import { registerAllocationRoutes } from './routes/allocations.js';
import { registerCapacityRoutes } from './routes/capacity.js';
import { registerTrackerRoutes } from './routes/tracker.js';
import { registerPreferencesRoutes } from './routes/preferences.js';
import { setupSync } from './sync/setup.js';
import { getPrisma, type DB } from './db.js';
import type { Env } from './env.js';

export interface BuildAppOptions {
  logger?: boolean;
  db?: DB;
  env: Env;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);

  const db = opts.db ?? getPrisma();

  await app.register(cookie, { secret: opts.env.SESSION_SECRET });
  registerSessionHook(app, {
    db,
    cookieName: opts.env.SESSION_COOKIE_NAME,
    // Activates only when the operator opts in. Defaults to false; hard-rejected by the
    // env schema when NODE_ENV=production, so this can never fire in prod regardless.
    enablePreviewAdminBypass: opts.env.ENABLE_PREVIEW_ADMIN_BYPASS,
  });

  await registerAuthRoutes(app, { db, env: opts.env });
  registerProjectRoutes(app, { db });
  registerPeopleRoutes(app, { db });
  registerAllocationRoutes(app, { db });
  registerCapacityRoutes(app, { db });
  registerPreferencesRoutes(app, { db });

  const engine = setupSync({
    db,
    trackerTokenKey: opts.env.TRACKER_TOKEN_KEY,
    enableCron: opts.env.ENABLE_SYNC_CRON,
    logger: app.log,
  });
  registerTrackerRoutes(app, { db, env: opts.env, engine });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/api/me', async (request) => {
    if (!request.user) return { authenticated: false };
    return { authenticated: true, user: request.user };
  });

  return app;
}
