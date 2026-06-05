import type { FastifyInstance } from 'fastify';
import type { DB } from '../db.js';
import type { Env } from '../env.js';
import { requirePM } from '../plugins/guards.js';
import { buildInsightsOverview } from '../lib/insights-overview.js';

interface RegisterInsightsOptions {
  db: DB;
  env: Env;
}

export function registerInsightsRoutes(
  app: FastifyInstance,
  opts: RegisterInsightsOptions,
): void {
  const { db } = opts;

  app.get('/api/insights/overview', async (request) => {
    requirePM(request);
    return buildInsightsOverview(db);
  });
}
