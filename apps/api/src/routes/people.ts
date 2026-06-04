import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, TrackerProvider, type Person } from '@prisma/client';
import { NotFoundError, ValidationError } from '@torii/shared';
import type { DB } from '../db.js';
import type { Env } from '../env.js';
import { requireAdmin, requireUser } from '../plugins/guards.js';
import { buildPeopleNameIndex, secondariesForProject } from '../lib/role-secondaries.js';
import { computePersonHarvestWindows } from '../lib/person-harvest-windows.js';
import { decryptToken } from '../sync/encryption.js';
import { HarvestAdapter } from '../sync/harvest/HarvestAdapter.js';
import { plannedHoursForAllocation } from '@torii/shared';
import { serializeProject } from './projects.js';

const idParams = z.object({ id: z.string().min(1) });

const dateRangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function serializePerson(p: Person) {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    role: p.role,
    defaultCapacityPct: p.defaultCapacityPct,
    isAdmin: p.isAdmin,
    /** Harvest user ID bridge — null until an admin links them via /trackers. */
    harvestUserId: p.harvestUserId,
  };
}

function serializeAllocationWithProject(a: {
  id: string;
  projectId: string;
  personId: string;
  pct: number;
  start: Date;
  end: Date;
  project: { name: string; phase: string; state: string };
}) {
  return {
    id: a.id,
    projectId: a.projectId,
    personId: a.personId,
    pct: a.pct,
    start: a.start.toISOString().slice(0, 10),
    end: a.end.toISOString().slice(0, 10),
    project: {
      name: a.project.name,
      phase: a.project.phase,
      state: a.project.state,
    },
  };
}

interface RegisterPeopleOptions {
  db: DB;
  env: Env;
}

export function registerPeopleRoutes(
  app: FastifyInstance,
  opts: RegisterPeopleOptions,
): void {
  const { db, env } = opts;

  app.get('/api/people', async (request) => {
    requireUser(request);
    const people = await db.person.findMany({ orderBy: { name: 'asc' } });
    return people.map(serializePerson);
  });

  app.get('/api/people/:id', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);
    const person = await db.person.findUnique({ where: { id } });
    if (!person) throw new NotFoundError('Person not found');
    return serializePerson(person);
  });

  app.get('/api/people/:id/allocations', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);
    const { from, to } = dateRangeQuery.parse(request.query);
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const allocations = await db.allocation.findMany({
      where: {
        personId: id,
        start: { lte: toDate },
        end: { gte: fromDate },
      },
      include: {
        project: { select: { name: true, phase: true, state: true } },
      },
      orderBy: { start: 'asc' },
    });

    return allocations.map(serializeAllocationWithProject);
  });

  /**
   * Every project this person is on, across all four roles (owner / PM / SA / SC).
   * The same project appears more than once when the person holds multiple roles
   * on it. Drives the `/people/:id` page.
   *
   * Surfaces both primary (FK) and secondary (multi-person `details.*`) role
   * assignments. The single-FK schema can only hold one person per role, but
   * Monday allows multiple — this endpoint pulls in projects where the person
   * is listed as a co-role even when not the FK target.
   */
  app.get('/api/people/:id/projects', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);

    const person = await db.person.findUnique({ where: { id } });
    if (!person) throw new NotFoundError('Person not found');

    const [allPeople, projects, harvestWindows] = await Promise.all([
      db.person.findMany({ select: { id: true, name: true } }),
      db.project.findMany({
        where: {
          OR: [
            { ownerId: id },
            { projectManagerId: id },
            { solutionArchitectId: id },
            { solutionConsultantId: id },
            // Co-role: the person's name appears in any role's details string.
            // String-contains on JSONB is a candidate filter; the in-JS pass
            // below uses the splitter + name index to verify (avoids false
            // positives like substring matches inside another name).
            { details: { path: ['project_manager'], string_contains: person.name } },
            { details: { path: ['solution_architect'], string_contains: person.name } },
            { details: { path: ['solution_consultant'], string_contains: person.name } },
          ],
        },
        include: {
          customer: true,
          harvestProjects: true,
          projectManager: true,
          solutionArchitect: true,
          solutionConsultant: true,
        },
        orderBy: { name: 'asc' },
      }),
      computePersonHarvestWindows(db, person.harvestUserId),
    ]);
    const peopleIndex = buildPeopleNameIndex(allPeople);

    type Role = 'owner' | 'pm' | 'sa' | 'sc';
    const out: Array<{
      role: Role;
      primary: boolean;
      last30DaysHours: number | null;
      project: ReturnType<typeof serializeProject>;
    }> = [];

    function detailContains(detailsKey: 'project_manager' | 'solution_architect' | 'solution_consultant', projectDetails: Record<string, string | undefined>): boolean {
      const refs = secondariesForProject(
        projectDetails as { project_manager?: string; solution_architect?: string; solution_consultant?: string },
        // pretend nothing is primary so the helper returns EVERY named individual.
        { projectManagerId: null, solutionArchitectId: null, solutionConsultantId: null },
        peopleIndex,
      );
      const list =
        detailsKey === 'project_manager'
          ? refs.projectManager
          : detailsKey === 'solution_architect'
            ? refs.solutionArchitect
            : refs.solutionConsultant;
      return list.some((r) => r.id === id);
    }

    for (const project of projects) {
      const serialized = serializeProject(project, peopleIndex);
      const details = (project.details ?? {}) as Record<string, string | undefined>;
      const last30DaysHours = person.harvestUserId
        ? (harvestWindows.perProject30d.get(project.id) ?? 0)
        : null;

      if (project.ownerId === id) {
        out.push({ role: 'owner', primary: true, last30DaysHours, project: serialized });
      }

      // PM
      if (project.projectManagerId === id) {
        out.push({ role: 'pm', primary: true, last30DaysHours, project: serialized });
      } else if (detailContains('project_manager', details)) {
        out.push({ role: 'pm', primary: false, last30DaysHours, project: serialized });
      }

      // SA
      if (project.solutionArchitectId === id) {
        out.push({ role: 'sa', primary: true, last30DaysHours, project: serialized });
      } else if (detailContains('solution_architect', details)) {
        out.push({ role: 'sa', primary: false, last30DaysHours, project: serialized });
      }

      // SC
      if (project.solutionConsultantId === id) {
        out.push({ role: 'sc', primary: true, last30DaysHours, project: serialized });
      } else if (detailContains('solution_consultant', details)) {
        out.push({ role: 'sc', primary: false, last30DaysHours, project: serialized });
      }
    }
    return out;
  });

  /**
   * Admin-only: link this Person to a Harvest user id. Validates that the Harvest
   * user actually exists in the workspace AND that no other Person is already
   * holding that harvest_user_id (uniqueness enforced by the `Person.harvest_user_id`
   * unique index too, but we surface a clearer 400 here).
   */
  app.post('/api/people/:id/harvest-link', async (request) => {
    requireAdmin(request);
    const { id } = idParams.parse(request.params);
    const { harvestUserId } = z.object({ harvestUserId: z.string().min(1) }).parse(request.body);

    const person = await db.person.findUnique({ where: { id } });
    if (!person) throw new NotFoundError('Person not found');

    // Reject when another Person already holds this Harvest user id.
    const conflict = await db.person.findFirst({
      where: { harvestUserId, id: { not: id } },
    });
    if (conflict) {
      throw new ValidationError(
        `Harvest user ${harvestUserId} is already linked to another Torii Person`,
      );
    }

    // Validate the Harvest user exists via the connected Harvest workspace.
    const conn = await db.trackerConnection.findFirst({
      where: { provider: TrackerProvider.harvest },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!conn) throw new NotFoundError('No active Harvest connection');
    if (!conn.harvestAccountId) {
      throw new ValidationError('Harvest connection is missing account ID; re-authorize');
    }
    const accessToken = decryptToken(conn.accessTokenEnc, env.TRACKER_TOKEN_KEY);
    const adapter = new HarvestAdapter({
      workspace: conn.workspace,
      accessToken,
      accountId: conn.harvestAccountId,
    });
    const users = await adapter.listUsers();
    if (!users.some((u) => u.id === harvestUserId)) {
      throw new ValidationError(`Harvest user ${harvestUserId} not found in workspace`);
    }

    await db.person.update({ where: { id }, data: { harvestUserId } });
    return { ok: true };
  });

  app.delete('/api/people/:id/harvest-link', async (request, reply) => {
    requireAdmin(request);
    const { id } = idParams.parse(request.params);
    const person = await db.person.findUnique({ where: { id } });
    if (!person) throw new NotFoundError('Person not found');
    await db.person.update({ where: { id }, data: { harvestUserId: null } });
    reply.code(204);
    return null;
  });

  /**
   * Per-person Allocations vs. Actuals reconciliation. Returns one row per project
   * this person is allocated on. When the Person isn't linked to a Harvest user,
   * `actualHours` / `variance` / `variancePct` are all null.
   */
  app.get('/api/people/:id/reconciliation', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);

    const person = await db.person.findUnique({ where: { id } });
    if (!person) throw new NotFoundError('Person not found');

    // All of this Person's allocations, grouped by project. Each project's pinned
    // Harvest projects are joined so we can sum actuals across them.
    const allocations = await db.allocation.findMany({
      where: { personId: id },
      include: {
        project: {
          include: { harvestProjects: true },
        },
      },
      orderBy: { start: 'asc' },
    });

    interface PerProject {
      projectId: string;
      projectName: string;
      plannedHours: number;
      harvestProjects: typeof allocations[number]['project']['harvestProjects'];
    }
    const byProject = new Map<string, PerProject>();
    for (const a of allocations) {
      const planned = plannedHoursForAllocation({
        pct: a.pct,
        defaultCapacityPct: person.defaultCapacityPct,
        startISO: a.start.toISOString().slice(0, 10),
        endISO: a.end.toISOString().slice(0, 10),
      });
      const existing = byProject.get(a.projectId);
      if (existing) {
        existing.plannedHours += planned;
      } else {
        byProject.set(a.projectId, {
          projectId: a.projectId,
          projectName: a.project.name,
          plannedHours: planned,
          harvestProjects: a.project.harvestProjects,
        });
      }
    }

    // For each project, sum actual hours across every pinned Harvest project's
    // breakdown[].people[] rows matching this Person's harvest_user_id.
    const harvestUserId = person.harvestUserId;
    const rows = [...byProject.values()].map((p) => {
      let actualHours: number | null = null;
      if (harvestUserId && p.harvestProjects.length > 0) {
        let sum = 0;
        for (const hp of p.harvestProjects) {
          const breakdown = (hp.breakdown ?? []) as Array<{
            people?: Array<{ personId: string; hours: number }>;
          }>;
          for (const task of breakdown) {
            for (const personRow of task.people ?? []) {
              if (personRow.personId === harvestUserId) sum += personRow.hours;
            }
          }
        }
        actualHours = Number(sum.toFixed(2));
      }
      const variance = actualHours === null ? null : Number((actualHours - p.plannedHours).toFixed(2));
      const variancePct =
        actualHours === null || p.plannedHours <= 0
          ? null
          : Number((((actualHours - p.plannedHours) / p.plannedHours) * 100).toFixed(2));
      return {
        projectId: p.projectId,
        projectName: p.projectName,
        plannedHours: Number(p.plannedHours.toFixed(2)),
        actualHours,
        variance,
        variancePct,
        linkedToHarvest: Boolean(harvestUserId),
      };
    });

    rows.sort((a, b) => a.projectName.localeCompare(b.projectName));
    return rows;
  });
}
