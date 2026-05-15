import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Person } from '@prisma/client';
import { NotFoundError } from '@torii/shared';
import type { DB } from '../db.js';
import { requireUser } from '../plugins/guards.js';

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
}

export function registerPeopleRoutes(
  app: FastifyInstance,
  opts: RegisterPeopleOptions,
): void {
  const { db } = opts;

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
}
