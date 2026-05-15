import cron, { type ScheduledTask } from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { registerAdapter } from './registry.js';
import { MondayAdapter } from './monday/MondayAdapter.js';
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
