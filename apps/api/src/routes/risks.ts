import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RagLevel, RiskState, RiskType } from '@prisma/client';
import type { DB } from '../db.js';
import { ForbiddenError } from '@torii/shared';
import { requireUser } from '../plugins/guards.js';
import { isoWeekMondayUTC, toIsoDateUTC } from '../lib/iso-week.js';

interface RegisterRisksOptions {
  db: DB;
}

interface AtRiskRow {
  project_id: string;
  project_name: string;
  customer_id: string | null;
  customer_name: string | null;
  week_of: Date;
  rag_level: RagLevel;
  risk_types: RiskType[];
  state: RiskState;
  description: string;
}

interface LatestUpdateRow {
  project_id: string;
  project_name: string;
  customer_id: string | null;
  customer_name: string | null;
  week_of: Date | null;
  rag_level: RagLevel | null;
}

const STALE_THRESHOLD_WEEKS = 2;
const STALE_LIMIT = 100;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function titleFromDescription(description: string): string {
  const trimmed = description.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 120) return trimmed;
  return `${trimmed.slice(0, 119)}…`;
}

const querySchema = z.object({
  include: z.string().optional(),
});

export function registerRiskRoutes(
  app: FastifyInstance,
  opts: RegisterRisksOptions,
): void {
  const { db } = opts;

  app.get('/api/risks', async (request) => {
    requireUser(request);
    const { include } = querySchema.parse(request.query);
    const wantStale = include === 'stale';

    // At-risk listing — same DISTINCT-ON shape as before, joined to customers
    // for the new customerId/customerName fields.
    const rows = await db.$queryRaw<AtRiskRow[]>`
      SELECT DISTINCT ON (r.project_id)
        r.project_id,
        p.name AS project_name,
        c.id AS customer_id,
        c.name AS customer_name,
        r.week_of,
        r.rag_level,
        r.risk_types,
        r.state,
        r.description
      FROM project_risk_updates r
      JOIN projects p ON p.id = r.project_id
      LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.state <> 'Done'
      ORDER BY r.project_id, r.week_of DESC
    `;

    const atRisk = rows
      .filter((r) => r.rag_level !== 'Green')
      .map((r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        customerId: r.customer_id,
        customerName: r.customer_name,
        weekOf: toIsoDateUTC(r.week_of),
        ragLevel: r.rag_level,
        riskTypes: r.risk_types,
        state: r.state,
        title: titleFromDescription(r.description),
      }));

    if (!wantStale) return atRisk;

    // Stale rows: every active project whose latest ProjectRiskUpdate.week_of is
    // more than 2 ISO weeks before today's Monday, OR has no update at all.
    const currentMonday = isoWeekMondayUTC(new Date());
    const staleCutoff = new Date(currentMonday.getTime() - STALE_THRESHOLD_WEEKS * MS_PER_WEEK);

    const latestPerProject = await db.$queryRaw<LatestUpdateRow[]>`
      SELECT
        p.id AS project_id,
        p.name AS project_name,
        c.id AS customer_id,
        c.name AS customer_name,
        latest.week_of AS week_of,
        latest.rag_level AS rag_level
      FROM projects p
      LEFT JOIN customers c ON c.id = p.customer_id
      LEFT JOIN LATERAL (
        SELECT week_of, rag_level
        FROM project_risk_updates
        WHERE project_id = p.id
        ORDER BY week_of DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE p.state <> 'Done'
    `;

    const stale = latestPerProject
      .filter((r) => {
        // Never-updated → stale.
        if (r.week_of === null) return true;
        // Older than the cutoff → stale (strictly more than 2 weeks).
        return r.week_of < staleCutoff;
      })
      .map((r) => {
        const weeksSinceLastUpdate =
          r.week_of === null
            ? null
            : Math.floor((currentMonday.getTime() - r.week_of.getTime()) / MS_PER_WEEK);
        return {
          projectId: r.project_id,
          projectName: r.project_name,
          customerId: r.customer_id,
          customerName: r.customer_name,
          lastRagLevel: r.rag_level,
          lastWeekOf: r.week_of ? toIsoDateUTC(r.week_of) : null,
          weeksSinceLastUpdate,
        };
      })
      .sort((a, b) => {
        // Nulls first (never-updated above the long-stale tail), then descending.
        if (a.weeksSinceLastUpdate === null && b.weeksSinceLastUpdate === null) return 0;
        if (a.weeksSinceLastUpdate === null) return -1;
        if (b.weeksSinceLastUpdate === null) return 1;
        return b.weeksSinceLastUpdate - a.weeksSinceLastUpdate;
      })
      .slice(0, STALE_LIMIT);

    return { atRisk, stale };
  });

  /**
   * PM-only digest endpoint: every project the viewer holds any role on
   * (owner / PM / SA / SC) where the current ISO week's ProjectRiskUpdate is
   * missing. Powers the bulk-update side panel on /risks.
   */
  app.get('/api/risks/my-week', async (request) => {
    const viewer = requireUser(request);
    if (viewer.role !== 'PM') {
      throw new ForbiddenError('PM role required');
    }

    const currentMonday = isoWeekMondayUTC(new Date());

    const projects = await db.project.findMany({
      where: {
        state: { not: 'Done' },
        OR: [
          { ownerId: viewer.id },
          { projectManagerId: viewer.id },
          { solutionArchitectId: viewer.id },
          { solutionConsultantId: viewer.id },
        ],
        // Sub-clause: no ProjectRiskUpdate exists for the current ISO week.
        NOT: {
          riskUpdates: { some: { weekOf: currentMonday } },
        },
      },
      include: { customer: true },
      orderBy: { name: 'asc' },
    });

    return projects.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      projectPhase: p.phase,
      projectState: p.state,
      customerId: p.customerId,
      customerName: p.customer?.name ?? null,
    }));
  });
}
