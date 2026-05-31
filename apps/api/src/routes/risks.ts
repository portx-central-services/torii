import type { FastifyInstance } from 'fastify';
import type { RagLevel, RiskState, RiskType } from '@prisma/client';
import type { DB } from '../db.js';
import { requireUser } from '../plugins/guards.js';

interface RegisterRisksOptions {
  db: DB;
}

interface AtRiskRow {
  project_id: string;
  project_name: string;
  week_of: Date;
  rag_level: RagLevel;
  risk_types: RiskType[];
  state: RiskState;
  description: string;
}

function titleFromDescription(description: string): string {
  const trimmed = description.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 120) return trimmed;
  // 119 chars + 1-char horizontal-ellipsis = 120 total.
  return `${trimmed.slice(0, 119)}…`;
}

export function registerRiskRoutes(
  app: FastifyInstance,
  opts: RegisterRisksOptions,
): void {
  const { db } = opts;

  app.get('/api/risks', async (request) => {
    requireUser(request);

    // DISTINCT ON: take the most recent ProjectRiskUpdate per project, then keep
    // only those whose latest entry is not Green and whose project is not Done.
    const rows = await db.$queryRaw<AtRiskRow[]>`
      SELECT DISTINCT ON (r.project_id)
        r.project_id,
        p.name AS project_name,
        r.week_of,
        r.rag_level,
        r.risk_types,
        r.state,
        r.description
      FROM project_risk_updates r
      JOIN projects p ON p.id = r.project_id
      WHERE p.state <> 'Done'
      ORDER BY r.project_id, r.week_of DESC
    `;

    return rows
      .filter((r) => r.rag_level !== 'Green')
      .map((r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        weekOf: r.week_of.toISOString().slice(0, 10),
        ragLevel: r.rag_level,
        riskTypes: r.risk_types,
        state: r.state,
        title: titleFromDescription(r.description),
      }));
  });
}
