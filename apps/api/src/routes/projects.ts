import type { FastifyInstance } from 'fastify';
import { Phase, ProjectState, type Project } from '@prisma/client';
import { z } from 'zod';
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ProjectListFilterSchema,
  KeyDatesSchema,
  ValidationError,
  NotFoundError,
} from '@torii/shared';
import type { DB } from '../db.js';
import { requireUser, requirePM } from '../plugins/guards.js';

const idParams = z.object({ id: z.string().min(1) });

function serializeProject(p: Project) {
  return {
    id: p.id,
    name: p.name,
    phase: p.phase,
    state: p.state,
    keyDates: p.keyDates,
    ownerId: p.ownerId,
    trackerRef: p.trackerRef,
    fieldMapping: p.fieldMapping,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

interface RegisterProjectsOptions {
  db: DB;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  opts: RegisterProjectsOptions,
): void {
  const { db } = opts;

  app.get('/api/projects', async (request) => {
    requireUser(request);
    const filters = ProjectListFilterSchema.parse(request.query);

    const where: Record<string, unknown> = {};
    if (filters.phase) where.phase = filters.phase;
    if (filters.state) where.state = filters.state;
    if (filters.owner) where.ownerId = filters.owner;

    let orderBy: Record<string, 'asc' | 'desc'> = { name: 'asc' };
    if (filters.sort === 'name:desc') orderBy = { name: 'desc' };
    else if (filters.sort === 'target_go_live' || filters.sort === 'target_go_live:desc') {
      // keyDates is JSONB; Prisma orderBy doesn't support JSON path natively.
      // We fall back to name sort and document the limit.
      orderBy = { name: 'asc' };
    }

    const projects = await db.project.findMany({ where, orderBy });
    return projects.map(serializeProject);
  });

  app.get('/api/projects/:id', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);

    const project = await db.project.findUnique({
      where: { id },
      include: { allocations: true },
    });
    if (!project) throw new NotFoundError('Project not found');

    const trackerRef = project.trackerRef as { provider?: string } | null;
    let lastSyncedAt: string | null = null;
    if (trackerRef?.provider) {
      const conn = await db.trackerConnection.findFirst({
        // We don't have a per-project sync time; surface the connection's last sync.
        where: { provider: trackerRef.provider as 'monday' },
        orderBy: { lastSyncedAt: 'desc' },
      });
      lastSyncedAt = conn?.lastSyncedAt?.toISOString() ?? null;
    }

    return {
      ...serializeProject(project),
      allocations: project.allocations.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        personId: a.personId,
        pct: a.pct,
        start: a.start.toISOString().slice(0, 10),
        end: a.end.toISOString().slice(0, 10),
      })),
      lastSyncedAt,
    };
  });

  app.post('/api/projects', async (request, reply) => {
    requirePM(request);
    const input = ProjectCreateSchema.parse(request.body);

    const created = await db.project.create({
      data: {
        name: input.name,
        phase: input.phase ?? Phase.Discovery,
        state: input.state ?? ProjectState.OnTrack,
        keyDates: input.keyDates ?? {},
        ownerId: input.ownerId ?? null,
        fieldMapping: {},
      },
    });
    reply.code(201);
    return serializeProject(created);
  });

  app.patch('/api/projects/:id', async (request) => {
    const user = requirePM(request);
    const { id } = idParams.parse(request.params);
    const input = ProjectUpdateSchema.parse(request.body);

    const existing = await db.project.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Project not found');

    // If keyDates is being updated, merge with existing and re-validate
    let nextKeyDates = existing.keyDates as Record<string, string | undefined>;
    if (input.keyDates) {
      const merged = { ...nextKeyDates, ...input.keyDates };
      const validated = KeyDatesSchema.safeParse(merged);
      if (!validated.success) {
        throw new ValidationError('Invalid keyDates', validated.error.errors);
      }
      nextKeyDates = validated.data;
    }

    // Auto-Done rule: advancing to Hypercare with actual_go_live set ⇒ state=Done
    // unless caller explicitly passed state.
    let nextState = input.state ?? existing.state;
    const phaseChanging = input.phase && input.phase !== existing.phase;
    if (
      input.state === undefined &&
      input.phase === Phase.Hypercare &&
      (nextKeyDates.actual_go_live ?? (existing.keyDates as Record<string, string | undefined>).actual_go_live)
    ) {
      nextState = ProjectState.Done;
    }

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.project.update({
        where: { id },
        data: {
          name: input.name ?? existing.name,
          phase: input.phase ?? existing.phase,
          state: nextState,
          keyDates: nextKeyDates,
          ownerId: input.ownerId !== undefined ? input.ownerId : existing.ownerId,
        },
      });
      if (phaseChanging && input.phase) {
        await tx.phaseAuditLog.create({
          data: {
            projectId: id,
            fromPhase: existing.phase,
            toPhase: input.phase,
            actorId: user.id,
          },
        });
      }
      return u;
    });

    return serializeProject(updated);
  });
}
