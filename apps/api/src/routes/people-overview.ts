import type { FastifyInstance } from 'fastify';
import { Phase, ProjectState } from '@prisma/client';
import {
  varianceBucket,
  plannedHoursForAllocation,
  type VarianceBucket,
} from '@torii/shared';
import type { DB } from '../db.js';
import { requireUser } from '../plugins/guards.js';
import { buildPeopleNameIndex, secondariesForProject } from '../lib/role-secondaries.js';

interface RegisterPeopleOverviewOptions {
  db: DB;
}

interface OverviewRowProject {
  projectId: string;
  projectName: string;
  projectPhase: Phase;
  /** Customer this project belongs to. Null when the project isn't mapped yet. */
  customerId: string | null;
  customerName: string | null;
  weeklyPct: number;
  allocatedPct: number;
  lifetimeHours: number | null;
  varianceBucket: VarianceBucket;
}

interface OverviewRow {
  id: string;
  name: string;
  email: string;
  role: 'PM' | 'Viewer';
  isAdmin: boolean;
  harvestUserId: string | null;
  defaultCapacityPct: number;
  availabilityPct: number;
  committedPct: number;
  billedHoursLast30d: number | null;
  billedHoursAsOf: string | null;
  lastReportedAt: string | null;
  currentProjects: OverviewRowProject[];
}

export function registerPeopleOverviewRoutes(
  app: FastifyInstance,
  opts: RegisterPeopleOverviewOptions,
): void {
  const { db } = opts;

  app.get('/api/people/overview', async (request) => {
    requireUser(request);

    const todayUtc = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
    );

    const people = await db.person.findMany({ orderBy: { name: 'asc' } });
    if (people.length === 0) return [] as OverviewRow[];

    const personIds = people.map((p) => p.id);

    // All three "currently working on" sources filter to `project.state != Done`
    // so the index never surfaces a stale Allocation or capacity row on a wrapped-up
    // project. The role-based query applies the same rule directly via its `state`
    // clause below.
    const capacities = await db.personProjectCapacity.findMany({
      where: {
        personId: { in: personIds },
        project: { state: { not: 'Done' } },
      },
      include: { project: { include: { customer: true } } },
    });

    const allocations = await db.allocation.findMany({
      where: {
        personId: { in: personIds },
        start: { lte: todayUtc },
        end: { gte: todayUtc },
        project: { state: { not: 'Done' } },
      },
      include: { project: { include: { customer: true } } },
    });

    // For variance bucket math, we also need total planned hours per (person,
    // project) across ALL allocations (not just active). Pull that once.
    const allAllocations = await db.allocation.findMany({
      where: { personId: { in: personIds } },
    });

    // Role-based "current projects": non-Done projects where this person is
    // listed as Owner / PM / SA / SC via the FK columns. PortX populates these
    // from Monday sync, so they're the most reliable "what's a person actually
    // on" signal — more so than formal Allocation rows.
    // Role-FK projects, plus projects with any multi-person details string
    // that mentions one of our people. The string_contains filter is broad —
    // the in-memory pass below uses the name-index splitter to verify each
    // match precisely (so "Greg Newton" won't false-match "Greg Newton-Smith").
    const nameContainsClauses = people.flatMap((person) => [
      { details: { path: ['project_manager'], string_contains: person.name } },
      { details: { path: ['solution_architect'], string_contains: person.name } },
      { details: { path: ['solution_consultant'], string_contains: person.name } },
    ]);
    const roleProjects = await db.project.findMany({
      where: {
        state: { not: 'Done' },
        OR: [
          { ownerId: { in: personIds } },
          { projectManagerId: { in: personIds } },
          { solutionArchitectId: { in: personIds } },
          { solutionConsultantId: { in: personIds } },
          ...nameContainsClauses,
        ],
      },
      include: { customer: true },
    });

    // Name index — used below to map each project's multi-person details
    // strings to Person rows, so secondaries surface in the same currentProjects
    // union the FK primaries do.
    const peopleNameIndex = buildPeopleNameIndex(people);
    // Pre-resolve secondary individuals per project so we don't re-split
    // identical strings inside the per-person loop.
    const secondariesByProjectId = new Map<string, ReturnType<typeof secondariesForProject>>();
    for (const p of roleProjects) {
      const d = (p.details ?? {}) as { project_manager?: string; solution_architect?: string; solution_consultant?: string };
      secondariesByProjectId.set(
        p.id,
        secondariesForProject(
          d,
          { projectManagerId: null, solutionArchitectId: null, solutionConsultantId: null },
          peopleNameIndex,
        ),
      );
    }

    // For lifetime hours we read HarvestProject breakdowns for projects in our set.
    const projectIdsInPlay = new Set<string>();
    for (const c of capacities) projectIdsInPlay.add(c.projectId);
    for (const a of allocations) projectIdsInPlay.add(a.projectId);
    for (const p of roleProjects) projectIdsInPlay.add(p.id);

    const harvestProjects =
      projectIdsInPlay.size === 0
        ? []
        : await db.harvestProject.findMany({
            where: { projectId: { in: [...projectIdsInPlay] } },
            select: { projectId: true, breakdown: true },
          });

    // Pre-index breakdowns by projectId → harvestUserId → hours.
    const hoursByProjectByUser = new Map<string, Map<string, number>>();
    for (const hp of harvestProjects) {
      if (!hp.projectId) continue;
      const breakdown = (hp.breakdown ?? []) as Array<{
        people?: Array<{ personId: string; hours: number }>;
      }>;
      let map = hoursByProjectByUser.get(hp.projectId);
      if (!map) {
        map = new Map();
        hoursByProjectByUser.set(hp.projectId, map);
      }
      for (const task of breakdown) {
        for (const row of task.people ?? []) {
          map.set(row.personId, (map.get(row.personId) ?? 0) + row.hours);
        }
      }
    }

    const result: OverviewRow[] = people.map((person) => {
      // Capacity rows for this person, indexed by projectId.
      const myCapacities = capacities.filter((c) => c.personId === person.id);
      // Active allocations for this person.
      const myActiveAllocs = allocations.filter((a) => a.personId === person.id);
      // All allocations for this person (for planned-hours math).
      const myAllAllocs = allAllocations.filter((a) => a.personId === person.id);

      const committedPct = myCapacities.reduce((sum, c) => sum + c.weeklyPct, 0);

      const lastReportedAt =
        myCapacities.length === 0
          ? null
          : myCapacities
              .reduce<Date>(
                (latest, c) => (c.updatedAt > latest ? c.updatedAt : latest),
                new Date(0),
              )
              .toISOString();

      // Union: capacity rows + active allocations + role-based assignments
      // (Owner / PM / SA / SC where project.state != Done). The role-based set
      // is the most populated at PortX scale; allocations + capacity layer
      // additional precision when present.
      type AccProject = typeof allocations[number]['project'];
      type Acc = {
        project: AccProject;
        weeklyPct: number;
        allocatedPct: number;
      };
      const byProject = new Map<string, Acc>();
      for (const c of myCapacities) {
        byProject.set(c.projectId, {
          project: c.project,
          weeklyPct: c.weeklyPct,
          allocatedPct: 0,
        });
      }
      for (const a of myActiveAllocs) {
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
      for (const p of roleProjects) {
        const fkMatch =
          p.ownerId === person.id ||
          p.projectManagerId === person.id ||
          p.solutionArchitectId === person.id ||
          p.solutionConsultantId === person.id;
        const secondaries = secondariesByProjectId.get(p.id);
        const secondaryMatch =
          !!secondaries &&
          (secondaries.projectManager.some((r) => r.id === person.id) ||
            secondaries.solutionArchitect.some((r) => r.id === person.id) ||
            secondaries.solutionConsultant.some((r) => r.id === person.id));
        if (!fkMatch && !secondaryMatch) continue;
        if (byProject.has(p.id)) continue;
        byProject.set(p.id, { project: p, weeklyPct: 0, allocatedPct: 0 });
      }

      // Planned hours per project (across ALL allocations, for variance math).
      const plannedByProject = new Map<string, number>();
      if (person.harvestUserId) {
        for (const a of myAllAllocs) {
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

      const currentProjects: OverviewRowProject[] = [...byProject.values()]
        .map((acc) => {
          let lifetimeHours: number | null = null;
          if (person.harvestUserId) {
            const byUser = hoursByProjectByUser.get(acc.project.id);
            lifetimeHours = Number((byUser?.get(person.harvestUserId) ?? 0).toFixed(2));
          }
          const planned = plannedByProject.get(acc.project.id) ?? 0;
          // Customer relation is present on all three sources of `project` (capacity,
          // allocation, and role-based), so this access is safe.
          const customer = (acc.project as AccProject & { customer?: { id: string; name: string } | null }).customer ?? null;
          return {
            projectId: acc.project.id,
            projectName: acc.project.name,
            projectPhase: acc.project.phase,
            customerId: customer?.id ?? null,
            customerName: customer?.name ?? null,
            weeklyPct: acc.weeklyPct,
            allocatedPct: acc.allocatedPct,
            lifetimeHours,
            varianceBucket: varianceBucket(planned, lifetimeHours),
          };
        })
        .sort((a, b) => {
          // Sort by customer name (with null/unmapped last), then by project name.
          const ca = a.customerName ?? '￿';
          const cb = b.customerName ?? '￿';
          const cmp = ca.localeCompare(cb);
          return cmp !== 0 ? cmp : a.projectName.localeCompare(b.projectName);
        });

      return {
        id: person.id,
        name: person.name,
        email: person.email,
        role: person.role,
        isAdmin: person.isAdmin,
        harvestUserId: person.harvestUserId,
        defaultCapacityPct: person.defaultCapacityPct,
        availabilityPct: person.availabilityPct,
        committedPct,
        billedHoursLast30d:
          person.billedHoursLast30d === null ? null : Number(person.billedHoursLast30d),
        billedHoursAsOf: person.billedHoursAsOf?.toISOString() ?? null,
        lastReportedAt,
        currentProjects,
      };
    });

    return result;
  });
}

// `ProjectState` is imported for type narrowing on the Project relation but is
// otherwise unused; the `void` keeps strict TS happy without altering shape.
void ProjectState;
