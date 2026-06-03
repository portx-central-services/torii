import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Phase, ProjectState } from '@prisma/client';
import {
  ForbiddenError,
  NotFoundError,
  varianceBucket,
  plannedHoursForAllocation,
  type VarianceBucket,
} from '@torii/shared';
import type { DB } from '../db.js';
import { requireUser } from '../plugins/guards.js';

interface RegisterWorkloadOptions {
  db: DB;
}

const idParams = z.object({ id: z.string().min(1) });

const pct = z.number().int().min(0).max(100);
const workloadPatchSchema = z
  .object({
    availabilityPct: pct.optional(),
    projects: z
      .array(
        z.object({
          projectId: z.string().min(1),
          weeklyPct: pct,
        }),
      )
      .optional(),
  })
  .refine(
    (v) => v.availabilityPct !== undefined || (v.projects && v.projects.length > 0),
    { message: 'Body must include availabilityPct and/or non-empty projects' },
  );

interface WorkloadRow {
  projectId: string;
  projectName: string;
  projectPhase: Phase;
  projectState: ProjectState;
  weeklyPct: number;
  allocatedPct: number;
  lifetimeHours: number | null;
  varianceBucket: VarianceBucket;
}

interface WorkloadResponse {
  availabilityPct: number;
  defaultCapacityPct: number;
  lastReportedAt: string | null;
  projects: WorkloadRow[];
}

async function buildWorkload(db: DB, personId: string): Promise<WorkloadResponse> {
  const person = await db.person.findUnique({ where: { id: personId } });
  if (!person) throw new NotFoundError('Person not found');

  const todayUtc = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
  );

  // Capacity rows owned by this person.
  const capacities = await db.personProjectCapacity.findMany({
    where: { personId },
    include: { project: true },
  });

  // Active allocations: today between start and end (inclusive).
  const allocations = await db.allocation.findMany({
    where: {
      personId,
      start: { lte: todayUtc },
      end: { gte: todayUtc },
    },
    include: { project: true },
  });

  // Build the union by project id.
  type Acc = {
    project: typeof allocations[number]['project'];
    weeklyPct: number;
    allocatedPct: number;
  };
  const byProject = new Map<string, Acc>();

  for (const c of capacities) {
    byProject.set(c.projectId, {
      project: c.project,
      weeklyPct: c.weeklyPct,
      allocatedPct: 0,
    });
  }
  for (const a of allocations) {
    const existing = byProject.get(a.projectId);
    if (existing) {
      existing.allocatedPct += a.pct;
    } else {
      byProject.set(a.projectId, {
        project: a.project,
        weeklyPct: 0,
        allocatedPct: a.pct,
      });
    }
  }

  // Lifetime hours per project: sum the person's hours across every pinned
  // HarvestProject row whose `projectId` is in our project set. Skip when the
  // person isn't Harvest-linked.
  const projectIds = [...byProject.keys()];
  const harvestHoursByProject = new Map<string, number>();
  if (person.harvestUserId && projectIds.length > 0) {
    const harvestProjects = await db.harvestProject.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, breakdown: true },
    });
    for (const hp of harvestProjects) {
      if (!hp.projectId) continue;
      const breakdown = (hp.breakdown ?? []) as Array<{
        people?: Array<{ personId: string; hours: number }>;
      }>;
      let sum = 0;
      for (const task of breakdown) {
        for (const row of task.people ?? []) {
          if (row.personId === person.harvestUserId) sum += row.hours;
        }
      }
      harvestHoursByProject.set(
        hp.projectId,
        (harvestHoursByProject.get(hp.projectId) ?? 0) + sum,
      );
    }
  }

  // Total planned hours per project for the variance comparison. We reuse the
  // same `plannedHoursForAllocation` math the reconciliation panel uses, summed
  // across ALL of this person's allocations on that project (not just active).
  const plannedByProject = new Map<string, number>();
  if (person.harvestUserId) {
    const allAllocations = await db.allocation.findMany({
      where: { personId, projectId: { in: projectIds } },
    });
    for (const a of allAllocations) {
      const planned = plannedHoursForAllocation({
        pct: a.pct,
        defaultCapacityPct: person.defaultCapacityPct,
        startISO: a.start.toISOString().slice(0, 10),
        endISO: a.end.toISOString().slice(0, 10),
      });
      plannedByProject.set(
        a.projectId,
        (plannedByProject.get(a.projectId) ?? 0) + planned,
      );
    }
  }

  const projects: WorkloadRow[] = [...byProject.values()]
    .map((acc) => {
      const lifetimeHours = person.harvestUserId
        ? Number((harvestHoursByProject.get(acc.project.id) ?? 0).toFixed(2))
        : null;
      const planned = plannedByProject.get(acc.project.id) ?? 0;
      const bucket = varianceBucket(planned, lifetimeHours);
      return {
        projectId: acc.project.id,
        projectName: acc.project.name,
        projectPhase: acc.project.phase,
        projectState: acc.project.state,
        weeklyPct: acc.weeklyPct,
        allocatedPct: acc.allocatedPct,
        lifetimeHours,
        varianceBucket: bucket,
      };
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName));

  const lastReportedAt =
    capacities.length === 0
      ? null
      : capacities
          .reduce<Date>((latest, c) => (c.updatedAt > latest ? c.updatedAt : latest), new Date(0))
          .toISOString();

  return {
    availabilityPct: person.availabilityPct,
    defaultCapacityPct: person.defaultCapacityPct,
    lastReportedAt,
    projects,
  };
}

export function registerWorkloadRoutes(
  app: FastifyInstance,
  opts: RegisterWorkloadOptions,
): void {
  const { db } = opts;

  app.get('/api/people/:id/workload', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);
    return buildWorkload(db, id);
  });

  app.patch('/api/people/:id/workload', async (request) => {
    const viewer = requireUser(request);
    const { id } = idParams.parse(request.params);
    const input = workloadPatchSchema.parse(request.body);

    if (viewer.id !== id && !viewer.isAdmin) {
      throw new ForbiddenError("You can only edit your own workload (or be an admin to edit someone else's)");
    }

    const person = await db.person.findUnique({ where: { id } });
    if (!person) throw new NotFoundError('Person not found');

    // Single transaction: availability + per-project upserts/deletes.
    await db.$transaction(async (tx) => {
      if (input.availabilityPct !== undefined) {
        await tx.person.update({
          where: { id },
          data: { availabilityPct: input.availabilityPct },
        });
      }
      for (const row of input.projects ?? []) {
        if (row.weeklyPct === 0) {
          await tx.personProjectCapacity.deleteMany({
            where: { personId: id, projectId: row.projectId },
          });
        } else {
          await tx.personProjectCapacity.upsert({
            where: {
              personId_projectId: { personId: id, projectId: row.projectId },
            },
            update: { weeklyPct: row.weeklyPct },
            create: {
              personId: id,
              projectId: row.projectId,
              weeklyPct: row.weeklyPct,
            },
          });
        }
      }
    });

    return buildWorkload(db, id);
  });
}
