import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Allocation } from '@prisma/client';
import {
  AllocationCreateSchema,
  AllocationUpdateSchema,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@torii/shared';
import type { DB } from '../db.js';
import { requirePM } from '../plugins/guards.js';

const idParams = z.object({ id: z.string().min(1) });

function serializeAllocation(a: Allocation) {
  return {
    id: a.id,
    projectId: a.projectId,
    personId: a.personId,
    pct: a.pct,
    start: a.start.toISOString().slice(0, 10),
    end: a.end.toISOString().slice(0, 10),
  };
}

async function findOverlap(
  db: DB,
  args: { projectId: string; personId: string; start: Date; end: Date; excludeId?: string },
) {
  return db.allocation.findFirst({
    where: {
      projectId: args.projectId,
      personId: args.personId,
      start: { lte: args.end },
      end: { gte: args.start },
      ...(args.excludeId ? { NOT: { id: args.excludeId } } : {}),
    },
  });
}

interface RegisterAllocationsOptions {
  db: DB;
}

export function registerAllocationRoutes(
  app: FastifyInstance,
  opts: RegisterAllocationsOptions,
): void {
  const { db } = opts;

  app.post('/api/allocations', async (request, reply) => {
    requirePM(request);
    const input = AllocationCreateSchema.parse(request.body);
    const start = new Date(input.start);
    const end = new Date(input.end);

    const overlap = await findOverlap(db, {
      projectId: input.projectId,
      personId: input.personId,
      start,
      end,
    });
    if (overlap) {
      throw new ConflictError(
        'Allocation overlaps an existing allocation for the same person and project',
      );
    }

    const created = await db.allocation.create({
      data: {
        projectId: input.projectId,
        personId: input.personId,
        pct: input.pct,
        start,
        end,
      },
    });
    reply.code(201);
    return serializeAllocation(created);
  });

  app.patch('/api/allocations/:id', async (request) => {
    requirePM(request);
    const { id } = idParams.parse(request.params);
    const input = AllocationUpdateSchema.parse(request.body);

    const existing = await db.allocation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Allocation not found');

    const nextStart = input.start ? new Date(input.start) : existing.start;
    const nextEnd = input.end ? new Date(input.end) : existing.end;
    if (nextEnd < nextStart) {
      throw new ValidationError('end must be on or after start');
    }

    if (input.start !== undefined || input.end !== undefined) {
      const overlap = await findOverlap(db, {
        projectId: existing.projectId,
        personId: existing.personId,
        start: nextStart,
        end: nextEnd,
        excludeId: id,
      });
      if (overlap) {
        throw new ConflictError(
          'Allocation overlaps an existing allocation for the same person and project',
        );
      }
    }

    const updated = await db.allocation.update({
      where: { id },
      data: {
        pct: input.pct ?? existing.pct,
        start: nextStart,
        end: nextEnd,
      },
    });
    return serializeAllocation(updated);
  });

  app.delete('/api/allocations/:id', async (request, reply) => {
    requirePM(request);
    const { id } = idParams.parse(request.params);
    const existing = await db.allocation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Allocation not found');
    await db.allocation.delete({ where: { id } });
    reply.code(204);
  });
}
