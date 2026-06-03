import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CustomerReconciliationSchema,
  NotFoundError,
  ValidationError,
  plannedHoursForAllocation,
  type CustomerListItem,
  type CustomerReconciliation,
  type CustomerReconciliationProjectRow,
} from '@torii/shared';
import type { DB } from '../db.js';
import { requireAdmin, requirePM, requireUser } from '../plugins/guards.js';
import { serializeProject } from './projects.js';

interface RegisterCustomerRoutesOptions {
  db: DB;
}

const idParams = z.object({ id: z.string().min(1) });

const customerCreateSchema = z.object({
  name: z.string().min(1),
  harvestClientId: z.string().min(1).optional(),
});

const customerUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    harvestClientId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const harvestLinkBody = z.object({ harvestClientId: z.string().min(1) });

export function registerCustomerRoutes(
  app: FastifyInstance,
  opts: RegisterCustomerRoutesOptions,
): void {
  const { db } = opts;

  app.get('/api/customers', async (request) => {
    requireUser(request);
    const customers = await db.customer.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { projects: true, harvestProjects: true } },
        harvestProjects: {
          select: { spentHoursBillable: true, spentHoursNonbillable: true },
        },
      },
    });
    const rows: CustomerListItem[] = customers.map((c) => {
      const lifetimeHours = c.harvestProjects.reduce(
        (sum, hp) => sum + Number(hp.spentHoursBillable) + Number(hp.spentHoursNonbillable),
        0,
      );
      return {
        id: c.id,
        name: c.name,
        harvestClientId: c.harvestClientId,
        mondayProjectCount: c._count.projects,
        harvestProjectCount: c._count.harvestProjects,
        lifetimeHours: Number(lifetimeHours.toFixed(2)),
      };
    });
    return rows;
  });

  app.get('/api/customers/:id', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);
    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        projects: {
          include: {
            customer: true,
            harvestProjects: true,
            projectManager: true,
            solutionArchitect: true,
            solutionConsultant: true,
          },
          orderBy: { name: 'asc' },
        },
        harvestProjects: {
          orderBy: [{ isBillable: 'desc' }, { name: 'asc' }],
          include: { project: { select: { id: true, name: true } } },
        },
      },
    });
    if (!customer) throw new NotFoundError('Customer not found');

    return {
      id: customer.id,
      name: customer.name,
      harvestClientId: customer.harvestClientId,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
      projects: customer.projects.map(serializeProject),
      harvestProjects: customer.harvestProjects.map((hp) => ({
        id: hp.id,
        name: hp.name,
        customerId: hp.customerId,
        projectId: hp.projectId,
        isBillable: hp.isBillable,
        harvestProjectUrl: hp.harvestProjectUrl,
        budgetHours: hp.budgetHours === null ? null : Number(hp.budgetHours),
        spentHoursBillable: Number(hp.spentHoursBillable),
        spentHoursNonbillable: Number(hp.spentHoursNonbillable),
        fetchedAt: hp.fetchedAt.toISOString(),
        pinnedProject: hp.project ? { id: hp.project.id, name: hp.project.name } : null,
      })),
    };
  });

  app.post('/api/customers', async (request, reply) => {
    requirePM(request);
    const input = customerCreateSchema.parse(request.body);
    if (input.harvestClientId) {
      const conflict = await db.customer.findUnique({
        where: { harvestClientId: input.harvestClientId },
      });
      if (conflict) {
        throw new ValidationError(
          `Harvest client ${input.harvestClientId} is already linked to customer "${conflict.name}"`,
        );
      }
    }
    const created = await db.customer.create({
      data: { name: input.name, harvestClientId: input.harvestClientId ?? null },
    });
    reply.code(201);
    return {
      id: created.id,
      name: created.name,
      harvestClientId: created.harvestClientId,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  });

  app.patch('/api/customers/:id', async (request) => {
    requirePM(request);
    const { id } = idParams.parse(request.params);
    const input = customerUpdateSchema.parse(request.body);
    const existing = await db.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Customer not found');
    if (input.harvestClientId !== undefined && input.harvestClientId !== null) {
      const conflict = await db.customer.findFirst({
        where: { harvestClientId: input.harvestClientId, id: { not: id } },
      });
      if (conflict) {
        throw new ValidationError(
          `Harvest client ${input.harvestClientId} is already linked to customer "${conflict.name}"`,
        );
      }
    }
    const updated = await db.customer.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.harvestClientId !== undefined ? { harvestClientId: input.harvestClientId } : {}),
      },
    });
    return {
      id: updated.id,
      name: updated.name,
      harvestClientId: updated.harvestClientId,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });

  app.post('/api/customers/:id/harvest-link', async (request) => {
    requireAdmin(request);
    const { id } = idParams.parse(request.params);
    const { harvestClientId } = harvestLinkBody.parse(request.body);
    const existing = await db.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Customer not found');
    const conflict = await db.customer.findFirst({
      where: { harvestClientId, id: { not: id } },
    });
    if (conflict) {
      throw new ValidationError(
        `Harvest client ${harvestClientId} is already linked to customer "${conflict.name}"`,
      );
    }
    const updated = await db.customer.update({
      where: { id },
      data: { harvestClientId },
    });
    return {
      id: updated.id,
      name: updated.name,
      harvestClientId: updated.harvestClientId,
    };
  });

  app.delete('/api/customers/:id/harvest-link', async (request, reply) => {
    requireAdmin(request);
    const { id } = idParams.parse(request.params);
    const existing = await db.customer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('Customer not found');
    await db.customer.update({ where: { id }, data: { harvestClientId: null } });
    reply.code(204);
    return null;
  });

  app.get('/api/customers/:id/reconciliation', async (request) => {
    requireUser(request);
    const { id } = idParams.parse(request.params);
    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        projects: {
          include: {
            allocations: { include: { person: true } },
            harvestProjects: true,
          },
        },
        harvestProjects: {
          select: {
            id: true,
            projectId: true,
            budgetHours: true,
            spentHoursBillable: true,
            spentHoursNonbillable: true,
          },
        },
      },
    });
    if (!customer) throw new NotFoundError('Customer not found');

    let plannedHours = 0;
    const perProject: CustomerReconciliationProjectRow[] = customer.projects.map((p) => {
      const projectPlanned = p.allocations.reduce(
        (sum, a) =>
          sum +
          plannedHoursForAllocation({
            pct: a.pct,
            defaultCapacityPct: a.person.defaultCapacityPct,
            startISO: a.start.toISOString().slice(0, 10),
            endISO: a.end.toISOString().slice(0, 10),
          }),
        0,
      );
      plannedHours += projectPlanned;
      const projectActual = p.harvestProjects.reduce(
        (sum, hp) => sum + Number(hp.spentHoursBillable) + Number(hp.spentHoursNonbillable),
        0,
      );
      const varianceHours = projectActual - projectPlanned;
      return {
        projectId: p.id,
        projectName: p.name,
        plannedHours: Number(projectPlanned.toFixed(2)),
        actualHours: Number(projectActual.toFixed(2)),
        varianceHours: Number(varianceHours.toFixed(2)),
        variancePct:
          projectPlanned <= 0 ? null : Number(((varianceHours / projectPlanned) * 100).toFixed(2)),
        linkedHarvestProjectIds: p.harvestProjects.map((hp) => hp.id),
      };
    });

    let actualHours = 0;
    let supportHours = 0;
    let budgetSum = 0;
    let budgetCount = 0;
    for (const hp of customer.harvestProjects) {
      const spent = Number(hp.spentHoursBillable) + Number(hp.spentHoursNonbillable);
      actualHours += spent;
      if (hp.projectId === null) supportHours += spent;
      if (hp.budgetHours !== null) {
        const b = Number(hp.budgetHours);
        if (!Number.isNaN(b)) {
          budgetSum += b;
          budgetCount += 1;
        }
      }
    }
    const budgetHours = budgetCount > 0 ? budgetSum : null;

    const varianceHours = actualHours - plannedHours;
    const budgetVarianceHours = budgetHours === null ? null : actualHours - budgetHours;
    const response: CustomerReconciliation = CustomerReconciliationSchema.parse({
      customerId: customer.id,
      customerName: customer.name,
      plannedHours: Number(plannedHours.toFixed(2)),
      actualHours: Number(actualHours.toFixed(2)),
      supportHours: Number(supportHours.toFixed(2)),
      budgetHours: budgetHours === null ? null : Number(budgetHours.toFixed(2)),
      varianceHours: Number(varianceHours.toFixed(2)),
      variancePct:
        plannedHours <= 0 ? null : Number(((varianceHours / plannedHours) * 100).toFixed(2)),
      budgetVarianceHours:
        budgetVarianceHours === null ? null : Number(budgetVarianceHours.toFixed(2)),
      budgetVariancePct:
        budgetHours === null || budgetHours <= 0
          ? null
          : Number((((actualHours - budgetHours) / budgetHours) * 100).toFixed(2)),
      perProject,
    });
    return response;
  });
}
