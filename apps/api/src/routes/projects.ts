import type { FastifyInstance } from 'fastify';
import { Phase, ProjectState, type Project } from '@prisma/client';
import { z } from 'zod';
import {
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ProjectListFilterSchema,
  KeyDatesSchema,
  ProjectDetailsSchema,
  deriveProjectType,
  type ProjectDetails,
  ValidationError,
  NotFoundError,
} from '@torii/shared';
import type { DB } from '../db.js';
import { requireUser, requirePM } from '../plugins/guards.js';
import {
  buildPeopleNameIndex,
  secondariesForProject,
  type PeopleNameIndex,
  type PersonRef,
} from '../lib/role-secondaries.js';

const idParams = z.object({ id: z.string().min(1) });

type JoinedPerson = {
  id: string;
  name: string;
  email: string;
  role: 'PM' | 'Viewer';
  defaultCapacityPct: number;
  isAdmin: boolean;
};

type JoinedCustomer = {
  id: string;
  name: string;
};

/** Hours-shaped subset of a `HarvestProject` row; only what we need for aggregation. */
type JoinedHarvestProject = {
  budgetHours: { toString(): string } | number | null;
  spentHoursBillable: { toString(): string } | number;
  spentHoursNonbillable: { toString(): string } | number;
};

/**
 * `serializeProject` accepts `Project & { customer?, harvestProjects?, ...roles? }`.
 * Pass `customer: true` and `harvestProjects: true` in the Prisma `include` to populate
 * the customer block and the aggregated overBudget/budgetHours/spentHours.
 */
type ProjectWithRelations = Project & {
  customer?: JoinedCustomer | null;
  harvestProjects?: JoinedHarvestProject[] | null;
  projectManager?: JoinedPerson | null;
  solutionArchitect?: JoinedPerson | null;
  solutionConsultant?: JoinedPerson | null;
};

function personOut(p: JoinedPerson | null | undefined) {
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    defaultCapacityPct: p.defaultCapacityPct,
    isAdmin: p.isAdmin,
  };
}

/**
 * Roll up budget + spent hours across every pinned Harvest project for this Torii
 * project. Returns null for both when no pinned rows exist (caller distinguishes
 * "no Harvest linkage" from "linked but no budget").
 */
function aggregateHarvestHours(rows: JoinedHarvestProject[] | null | undefined): {
  budgetHours: number | null;
  spentHours: number | null;
} {
  if (!rows || rows.length === 0) return { budgetHours: null, spentHours: null };
  let budgetSum = 0;
  let budgetCount = 0;
  let spentSum = 0;
  for (const row of rows) {
    const budget = row.budgetHours === null ? null : Number(row.budgetHours);
    if (budget !== null && !Number.isNaN(budget)) {
      budgetSum += budget;
      budgetCount++;
    }
    spentSum += Number(row.spentHoursBillable) + Number(row.spentHoursNonbillable);
  }
  return {
    budgetHours: budgetCount > 0 ? budgetSum : null,
    spentHours: spentSum,
  };
}

function deriveOverBudget(rows: JoinedHarvestProject[] | null | undefined): boolean {
  const { budgetHours, spentHours } = aggregateHarvestHours(rows);
  if (budgetHours === null || budgetHours <= 0) return false;
  if (spentHours === null) return false;
  return spentHours > budgetHours;
}

export function serializeProject(
  p: ProjectWithRelations,
  peopleIndex?: PeopleNameIndex,
) {
  const details = (p.details ?? {}) as ProjectDetails;
  const hours = aggregateHarvestHours(p.harvestProjects);
  // When a people index is provided, surface every individual named in the
  // role detail strings beyond the FK primary. The single-FK schema can't
  // represent multi-person assignments, but the Monday strings can; this lets
  // every UI surface both. When the index is absent, secondaries default to
  // empty arrays (read paths that don't care can skip the cost).
  const empty = { projectManager: [] as PersonRef[], solutionArchitect: [] as PersonRef[], solutionConsultant: [] as PersonRef[] };
  const roleSecondaries = peopleIndex
    ? secondariesForProject(
        details as { project_manager?: string; solution_architect?: string; solution_consultant?: string },
        {
          projectManagerId: p.projectManagerId,
          solutionArchitectId: p.solutionArchitectId,
          solutionConsultantId: p.solutionConsultantId,
        },
        peopleIndex,
      )
    : empty;
  return {
    id: p.id,
    name: p.name,
    phase: p.phase,
    state: p.state,
    keyDates: p.keyDates,
    details,
    /** Derived from `details.fintech_parent`; not a persisted column. */
    projectType: deriveProjectType(details as Record<string, unknown>),
    /** Customer FK. Null when not yet mapped. */
    customerId: p.customerId ?? null,
    /** Resolved customer row. Null when the FK is unset or the relation was not included. */
    customer: p.customer ? { id: p.customer.id, name: p.customer.name } : null,
    /** Derived from the customer's pinned Harvest projects (sum of spent > sum of budget). */
    overBudget: deriveOverBudget(p.harvestProjects),
    /** Sum of budget hours across pinned Harvest projects; null when no pinned row has a budget. */
    budgetHours: hours.budgetHours,
    /** Sum of (billable + non-billable) spent hours across pinned Harvest projects; null when no pinned rows. */
    spentHours: hours.spentHours,
    ownerId: p.ownerId,
    /** Resolved Person rows for the three role FKs. Null when the FK is unset
     *  or the row was not included in the query. UI falls back to `details.*`. */
    projectManager: personOut(p.projectManager),
    solutionArchitect: personOut(p.solutionArchitect),
    solutionConsultant: personOut(p.solutionConsultant),
    /** Additional individuals beyond the FK primary (parsed from `details.<role>`
     *  comma-separated lists). Empty arrays when no secondaries exist. */
    roleSecondaries,
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

    const [projects, allPeople] = await Promise.all([
      db.project.findMany({
        where,
        orderBy,
        include: {
          customer: true,
          harvestProjects: true,
          projectManager: true,
          solutionArchitect: true,
          solutionConsultant: true,
        },
      }),
      db.person.findMany({ select: { id: true, name: true } }),
    ]);
    const peopleIndex = buildPeopleNameIndex(allPeople);
    return projects.map((p) => serializeProject(p, peopleIndex));
  });

  app.get('/api/projects/:id', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);

    const [project, allPeople] = await Promise.all([
      db.project.findUnique({
        where: { id },
        include: {
          allocations: true,
          customer: true,
          harvestProjects: true,
          projectManager: true,
          solutionArchitect: true,
          solutionConsultant: true,
        },
      }),
      db.person.findMany({ select: { id: true, name: true } }),
    ]);
    if (!project) throw new NotFoundError('Project not found');
    const peopleIndex = buildPeopleNameIndex(allPeople);

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
      ...serializeProject(project, peopleIndex),
      allocations: project.allocations.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        personId: a.personId,
        pct: a.pct,
        start: a.start.toISOString().slice(0, 10),
        end: a.end.toISOString().slice(0, 10),
      })),
      lastSyncedAt,
      trackerRaw: project.trackerRaw ?? null,
    };
  });

  app.post('/api/projects', async (request, reply) => {
    requirePM(request);
    const input = ProjectCreateSchema.parse(request.body);

    const created = await db.project.create({
      data: {
        name: input.name,
        phase: input.phase ?? Phase.Backlog,
        state: input.state ?? ProjectState.OnTrack,
        keyDates: input.keyDates ?? {},
        details: input.details ?? {},
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

    // If details is being updated, shallow-merge over existing and re-validate.
    let nextDetails = existing.details as Record<string, string | undefined>;
    if (input.details) {
      const merged = { ...nextDetails, ...input.details };
      const validated = ProjectDetailsSchema.safeParse(merged);
      if (!validated.success) {
        throw new ValidationError('Invalid details', validated.error.errors);
      }
      nextDetails = validated.data;
    }

    // Auto-Done rule: advancing to Production with actual_go_live set ⇒ state=Done
    // unless caller explicitly passed state.
    let nextState = input.state ?? existing.state;
    const phaseChanging = input.phase && input.phase !== existing.phase;
    if (
      input.state === undefined &&
      input.phase === Phase.Production &&
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
          details: nextDetails,
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
