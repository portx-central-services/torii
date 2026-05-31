import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ProjectRiskUpdateUpsertSchema,
  ValidationError,
  NotFoundError,
} from '@torii/shared';
import type { ProjectRiskUpdate } from '@prisma/client';
import type { DB } from '../db.js';
import { requireUser, requirePM } from '../plugins/guards.js';
import { isoWeekMondayUTC, parseIsoDateUTC, toIsoDateUTC } from '../lib/iso-week.js';

const idParams = z.object({ id: z.string().min(1) });

interface RegisterRiskUpdatesOptions {
  db: DB;
}

function serializeUpdate(
  row: ProjectRiskUpdate & { author?: { name: string } | null },
): {
  id: string;
  projectId: string;
  weekOf: string;
  ragLevel: string;
  riskTypes: string[];
  state: string;
  description: string;
  goToGreenPlan: string;
  latestUpdate: string;
  nextSteps: string;
  actionRequested: string;
  authorId: string;
  authorName?: string;
  createdAt: string;
  updatedAt: string;
} {
  const out: ReturnType<typeof serializeUpdate> = {
    id: row.id,
    projectId: row.projectId,
    weekOf: toIsoDateUTC(row.weekOf),
    ragLevel: row.ragLevel,
    riskTypes: row.riskTypes,
    state: row.state,
    description: row.description,
    goToGreenPlan: row.goToGreenPlan,
    latestUpdate: row.latestUpdate,
    nextSteps: row.nextSteps,
    actionRequested: row.actionRequested,
    authorId: row.authorId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.author?.name) out.authorName = row.author.name;
  return out;
}

export function registerRiskUpdateRoutes(
  app: FastifyInstance,
  opts: RegisterRiskUpdatesOptions,
): void {
  const { db } = opts;

  app.get('/api/projects/:id/risk-updates', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);
    const project = await db.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) throw new NotFoundError('Project not found');

    const rows = await db.projectRiskUpdate.findMany({
      where: { projectId: id },
      orderBy: { weekOf: 'desc' },
      include: { author: { select: { name: true } } },
    });
    return rows.map(serializeUpdate);
  });

  app.post('/api/projects/:id/risk-updates', async (request) => {
    const user = requirePM(request);
    const { id } = idParams.parse(request.params);
    const body = ProjectRiskUpdateUpsertSchema.parse(request.body);

    const project = await db.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) throw new NotFoundError('Project not found');

    const currentMonday = isoWeekMondayUTC(new Date());

    // If the caller passed an explicit `weekOf`, it MUST equal the current ISO week's Monday.
    if (body.weekOf !== undefined) {
      const parsed = parseIsoDateUTC(body.weekOf);
      if (!parsed || parsed.getTime() !== currentMonday.getTime()) {
        throw new ValidationError(
          `weekOf must equal the current ISO week's Monday (${toIsoDateUTC(currentMonday)})`,
        );
      }
    }

    const data = {
      ragLevel: body.ragLevel,
      riskTypes: body.riskTypes,
      state: body.state,
      description: body.description ?? '',
      goToGreenPlan: body.goToGreenPlan ?? '',
      latestUpdate: body.latestUpdate ?? '',
      nextSteps: body.nextSteps ?? '',
      actionRequested: body.actionRequested ?? '',
      authorId: user.id,
    };

    const row = await db.projectRiskUpdate.upsert({
      where: { projectId_weekOf: { projectId: id, weekOf: currentMonday } },
      create: { projectId: id, weekOf: currentMonday, ...data },
      update: data,
      include: { author: { select: { name: true } } },
    });
    return serializeUpdate(row);
  });
}
