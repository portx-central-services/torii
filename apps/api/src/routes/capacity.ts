import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  isoWeekStart,
  isoWeeksBetween,
  isoDateUtc,
  rangesOverlap,
  ValidationError,
} from '@torii/shared';
import type { DB } from '../db.js';
import { requireUser } from '../plugins/guards.js';

const rangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

interface PersonWeekTotal {
  personId: string;
  personName: string;
  committedPct: number;
  defaultCapacityPct: number;
  overAllocated: boolean;
}

interface ProjectWeekDemand {
  projectId: string;
  projectName: string;
  demandPct: number;
}

interface WeekBucket {
  weekStart: string; // yyyy-mm-dd
  weekEnd: string; // yyyy-mm-dd (Sunday)
  projects: ProjectWeekDemand[];
  people: PersonWeekTotal[];
}

interface RegisterCapacityOptions {
  db: DB;
}

export function registerCapacityRoutes(
  app: FastifyInstance,
  opts: RegisterCapacityOptions,
): void {
  const { db } = opts;

  app.get('/api/capacity/rollup', async (request) => {
    requireUser(request);
    const { from, to } = rangeQuery.parse(request.query);
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T23:59:59Z`);
    if (toDate < fromDate) {
      throw new ValidationError('`to` must be on or after `from`');
    }

    const weekStarts = isoWeeksBetween(fromDate, toDate);

    // Fetch allocations + their project + their person (needed for names & default capacity).
    const allocations = await db.allocation.findMany({
      where: {
        start: { lte: toDate },
        end: { gte: fromDate },
      },
      include: {
        project: { select: { id: true, name: true } },
        person: { select: { id: true, name: true, defaultCapacityPct: true } },
      },
    });

    const weeks: WeekBucket[] = weekStarts.map((weekStart) => {
      const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
      const projectTotals = new Map<string, ProjectWeekDemand>();
      const personTotals = new Map<string, PersonWeekTotal>();

      for (const a of allocations) {
        if (!rangesOverlap(a.start, a.end, weekStart, weekEnd)) continue;

        const projAgg = projectTotals.get(a.projectId) ?? {
          projectId: a.projectId,
          projectName: a.project.name,
          demandPct: 0,
        };
        projAgg.demandPct += a.pct;
        projectTotals.set(a.projectId, projAgg);

        const personAgg = personTotals.get(a.personId) ?? {
          personId: a.personId,
          personName: a.person.name,
          committedPct: 0,
          defaultCapacityPct: a.person.defaultCapacityPct,
          overAllocated: false,
        };
        personAgg.committedPct += a.pct;
        personAgg.overAllocated = personAgg.committedPct > personAgg.defaultCapacityPct;
        personTotals.set(a.personId, personAgg);
      }

      return {
        weekStart: isoDateUtc(weekStart),
        weekEnd: isoDateUtc(weekEnd),
        projects: Array.from(projectTotals.values()).sort((a, b) =>
          a.projectName.localeCompare(b.projectName),
        ),
        people: Array.from(personTotals.values()).sort(
          (a, b) => b.committedPct - a.committedPct,
        ),
      };
    });

    return {
      from: isoDateUtc(isoWeekStart(fromDate)),
      to: isoDateUtc(toDate),
      weeks,
    };
  });
}
