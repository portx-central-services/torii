import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import { requireUser } from '../plugins/guards.js';

interface RegisterSearchOptions {
  db: DB;
}

const SEARCH_LIMIT_PER_KIND = 8;

const queryParams = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export function registerSearchRoutes(
  app: FastifyInstance,
  opts: RegisterSearchOptions,
): void {
  const { db } = opts;

  /**
   * Global search across projects, customers, and people. Case-insensitive
   * substring match on `name`. Returns up to `limit` (default 8) per kind so
   * the topbar dropdown stays scannable.
   */
  app.get('/api/search', async (request) => {
    requireUser(request);
    const { q, limit } = queryParams.parse(request.query);
    const trimmed = (q ?? '').trim();
    if (trimmed.length === 0) {
      return { projects: [], customers: [], people: [] };
    }
    const take = limit ?? SEARCH_LIMIT_PER_KIND;
    const contains = { contains: trimmed, mode: 'insensitive' as const };

    const [projects, customers, people] = await Promise.all([
      db.project.findMany({
        where: { name: contains },
        select: { id: true, name: true, phase: true, state: true },
        orderBy: { name: 'asc' },
        take,
      }),
      db.customer.findMany({
        where: { name: contains },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take,
      }),
      db.person.findMany({
        where: { name: contains },
        select: { id: true, name: true, role: true, isAdmin: true },
        orderBy: { name: 'asc' },
        take,
      }),
    ]);

    return { projects, customers, people };
  });
}
