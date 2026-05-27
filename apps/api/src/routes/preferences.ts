import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PROJECT_DETAIL_KEYS } from '@torii/shared';
import type { DB } from '../db.js';
import { requireUser } from '../plugins/guards.js';

// Only the detail columns are hideable; base columns (name/phase/state/owner/
// target_go_live) always render.
const HIDEABLE_COLUMNS = new Set<string>(PROJECT_DETAIL_KEYS);

const preferencesBody = z.object({
  hiddenProjectColumns: z
    .array(z.string())
    .refine((cols) => cols.every((c) => HIDEABLE_COLUMNS.has(c)), {
      message: 'hiddenProjectColumns contains an unknown column id',
    }),
});

interface RegisterPreferencesOptions {
  db: DB;
}

function readHidden(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const cols = (data as { hiddenProjectColumns?: unknown }).hiddenProjectColumns;
  if (!Array.isArray(cols)) return [];
  return cols.filter((c): c is string => typeof c === 'string');
}

export function registerPreferencesRoutes(
  app: FastifyInstance,
  opts: RegisterPreferencesOptions,
): void {
  const { db } = opts;

  app.get('/api/me/preferences', async (request) => {
    const user = requireUser(request);
    const pref = await db.userPreference.findUnique({ where: { personId: user.id } });
    return { hiddenProjectColumns: readHidden(pref?.data) };
  });

  app.put('/api/me/preferences', async (request) => {
    const user = requireUser(request);
    const { hiddenProjectColumns } = preferencesBody.parse(request.body);
    const data = { hiddenProjectColumns };
    await db.userPreference.upsert({
      where: { personId: user.id },
      create: { personId: user.id, data },
      update: { data },
    });
    return { hiddenProjectColumns };
  });
}
