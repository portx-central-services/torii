import cron, { type ScheduledTask } from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { registerAdapter } from './registry.js';
import { MondayAdapter } from './monday/MondayAdapter.js';
import { HarvestAdapter } from './harvest/HarvestAdapter.js';
import { SyncEngine } from './engine.js';
import type { DB } from '../db.js';

let cronTask: ScheduledTask | null = null;

export interface SetupSyncOptions {
  db: DB;
  trackerTokenKey: string;
  enableCron: boolean;
  logger?: FastifyBaseLogger;
}

export function setupSync(opts: SetupSyncOptions): SyncEngine {
  registerAdapter('monday', (cfg) => new MondayAdapter(cfg));
  registerAdapter('harvest', (cfg) => {
    if (!cfg.accountId) {
      throw new Error('Harvest adapter requires accountId (the `Harvest-Account-Id` header value)');
    }
    return new HarvestAdapter({
      workspace: cfg.workspace,
      accessToken: cfg.accessToken,
      accountId: cfg.accountId,
    });
  });

  const engine = new SyncEngine({
    db: opts.db,
    trackerTokenKey: opts.trackerTokenKey,
  });

  if (opts.enableCron && !cronTask) {
    cronTask = cron.schedule('*/30 * * * *', async () => {
      try {
        const results = await engine.syncAllActive();
        opts.logger?.info({ results }, 'Scheduled sync tick complete');
      } catch (err) {
        opts.logger?.error({ err }, 'Scheduled sync tick failed');
      }
    });
  }

  return engine;
}

/** Test helper: stop the scheduled task if any. */
export function stopSyncCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}
