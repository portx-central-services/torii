import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, TrackerProvider, type Person } from '@prisma/client';
import { NotFoundError, ValidationError } from '@torii/shared';
import type { DB } from '../db.js';
import type { Env } from '../env.js';
import { requireAdmin, requireUser } from '../plugins/guards.js';
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
   */
  app.get('/api/people/:id/projects', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);

    const person = await db.person.findUnique({ where: { id } });
    if (!person) throw new NotFoundError('Person not found');

    const projects = await db.project.findMany({
      where: {
        OR: [
          { ownerId: id },
          { projectManagerId: id },
          { solutionArchitectId: id },
          { solutionConsultantId: id },
        ],
      },
      include: {
        harvestSnapshot: true,
        projectManager: true,
        solutionArchitect: true,
        solutionConsultant: true,
      },
      orderBy: { name: 'asc' },
    });

    // Enumerate the role(s) for each project; a project where this person is both
    // Owner and PM appears twice — once per role — so the UI can group cleanly.
    const out: Array<{ role: 'owner' | 'pm' | 'sa' | 'sc'; project: ReturnType<typeof serializeProject> }> = [];
    for (const project of projects) {
      const serialized = serializeProject(project);
      if (project.ownerId === id) out.push({ role: 'owner', project: serialized });
      if (project.projectManagerId === id) out.push({ role: 'pm', project: serialized });
      if (project.solutionArchitectId === id) out.push({ role: 'sa', project: serialized });
      if (project.solutionConsultantId === id) out.push({ role: 'sc', project: serialized });
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

    // All of this Person's allocations, grouped by project, with the joined Project + snapshot.
    const allocations = await db.allocation.findMany({
      where: { personId: id },
      include: {
        project: {
          include: { harvestSnapshot: true },
        },
      },
      orderBy: { start: 'asc' },
    });

    // Aggregate planned hours per project.
    interface PerProject {
      projectId: string;
      projectName: string;
      plannedHours: number;
      snapshot: typeof allocations[number]['project']['harvestSnapshot'];
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
          snapshot: a.project.harvestSnapshot,
        });
      }
    }

    // For each project, compute actual hours by summing breakdown[].people[].hours
    // where the harvest personId === person.harvestUserId.
    const harvestUserId = person.harvestUserId;
    const rows = [...byProject.values()].map((p) => {
      let actualHours: number | null = null;
      if (harvestUserId && p.snapshot) {
        const breakdown = (p.snapshot.breakdown ?? []) as Array<{
          people?: Array<{ personId: string; hours: number }>;
        }>;
        let sum = 0;
        for (const task of breakdown) {
          for (const personRow of task.people ?? []) {
            if (personRow.personId === harvestUserId) sum += personRow.hours;
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
