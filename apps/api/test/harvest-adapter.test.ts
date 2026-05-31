import { describe, it, expect, vi } from 'vitest';
import {
  HarvestAdapter,
  HarvestAuthError,
  HarvestRateLimitError,
} from '../src/sync/harvest/HarvestAdapter.js';
import { HarvestSnapshotSchema } from '@torii/shared';

function mkResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HarvestAdapter', () => {
  it('lists projects across pages', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        mkResponse(200, {
          projects: [
            { id: 1, name: 'Alpha' },
            { id: 2, name: 'Beta' },
          ],
          page: 1,
          total_pages: 2,
        }),
      )
      .mockResolvedValueOnce(
        mkResponse(200, {
          projects: [{ id: 3, name: 'Gamma' }],
          page: 2,
          total_pages: 2,
        }),
      );
    const adapter = new HarvestAdapter({
      workspace: 'portx',
      accessToken: 'tok',
      accountId: '999',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const items = await adapter.listProjects();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sends both Authorization and Harvest-Account-Id on every request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mkResponse(200, { projects: [], page: 1, total_pages: 1 }),
    );
    const adapter = new HarvestAdapter({
      workspace: 'portx',
      accessToken: 'tok',
      accountId: '12345',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await adapter.listProjects();
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining('/projects?is_active=true'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer tok',
          'Harvest-Account-Id': '12345',
        }),
      }),
    );
  });

  it('throws HarvestAuthError on 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    const adapter = new HarvestAdapter({
      workspace: 'portx',
      accessToken: 'tok',
      accountId: '1',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(adapter.listProjects()).rejects.toBeInstanceOf(HarvestAuthError);
  });

  it('throws HarvestAuthError on 403', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 403 }));
    const adapter = new HarvestAdapter({
      workspace: 'portx',
      accessToken: 'tok',
      accountId: '1',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(adapter.listProjects()).rejects.toBeInstanceOf(HarvestAuthError);
  });

  it('throws HarvestRateLimitError on 429', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('slow', { status: 429 }));
    const adapter = new HarvestAdapter({
      workspace: 'portx',
      accessToken: 'tok',
      accountId: '1',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(adapter.listProjects()).rejects.toBeInstanceOf(HarvestRateLimitError);
  });

  it('builds a snapshot aggregating per-(task, person) hours', async () => {
    // GET /v2/projects/:id  →  project budget metadata
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        mkResponse(200, {
          id: 39571483,
          name: 'Abrigo - Gulf Capital Bank',
          budget: 615,
          budget_by: 'project',
        }),
      )
      // GET /v2/reports/project_budget — paged
      .mockResolvedValueOnce(
        mkResponse(200, {
          results: [
            {
              project_id: 39571483,
              budget: 615,
              budget_by: 'project',
              billable_hours: 683.5,
              non_billable_hours: 155.0,
              total_hours: 838.5,
            },
          ],
          page: 1,
          total_pages: 1,
        }),
      )
      // GET /v2/time_entries — paged
      .mockResolvedValueOnce(
        mkResponse(200, {
          time_entries: [
            { id: 1, hours: 100, task: { id: 10, name: '03-Development' }, user: { id: 100, name: 'Gustavo Rostirolla' }, billable: true },
            { id: 2, hours: 50, task: { id: 10, name: '03-Development' }, user: { id: 100, name: 'Gustavo Rostirolla' }, billable: true },
            { id: 3, hours: 25, task: { id: 10, name: '03-Development' }, user: { id: 200, name: 'Vitor Barros' }, billable: true },
            { id: 4, hours: 80, task: { id: 20, name: '00-Project Management' }, user: { id: 300, name: 'Joao Garcia' }, billable: true },
          ],
          page: 1,
          total_pages: 1,
        }),
      );
    const adapter = new HarvestAdapter({
      workspace: 'portx',
      accessToken: 'tok',
      accountId: '999',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const { snapshot } = await adapter.getProjectSnapshot('39571483');

    expect(snapshot.budgetHours).toBe(615);
    expect(snapshot.spentHoursBillable).toBe(683.5);
    expect(snapshot.spentHoursNonbillable).toBe(155.0);
    expect(snapshot.harvestProjectId).toBe('39571483');
    expect(snapshot.harvestProjectUrl).toContain('portx.harvestapp.com/projects/39571483');

    expect(snapshot.breakdown).toHaveLength(2);
    const dev = snapshot.breakdown.find((t) => t.taskName === '03-Development');
    expect(dev).toBeDefined();
    expect(dev!.taskSpentHours).toBe(175);
    expect(dev!.people).toHaveLength(2);
    const gustavo = dev!.people.find((p) => p.personName === 'Gustavo Rostirolla');
    expect(gustavo!.hours).toBe(150);
  });

  it('omits budgetHours when budget_by is cost-based, not hours-based', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        mkResponse(200, {
          id: 1,
          name: 'Fees-budgeted',
          budget: 33000,
          budget_by: 'project_fees',
        }),
      )
      .mockResolvedValueOnce(
        mkResponse(200, { results: [{ project_id: 1, billable_hours: 100, non_billable_hours: 0 }], page: 1, total_pages: 1 }),
      )
      .mockResolvedValueOnce(mkResponse(200, { time_entries: [], page: 1, total_pages: 1 }));
    const adapter = new HarvestAdapter({
      workspace: 'portx',
      accessToken: 'tok',
      accountId: '1',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const { snapshot } = await adapter.getProjectSnapshot('1');
    expect(snapshot.budgetHours).toBeNull();
  });

  it('HarvestSnapshotSchema (with .strict()) rejects payloads carrying monetary keys', () => {
    const valid = {
      projectId: 'proj-1',
      fetchedAt: new Date().toISOString(),
      harvestProjectId: '1',
      harvestProjectUrl: 'https://portx.harvestapp.com/projects/1',
      budgetHours: 100,
      spentHoursBillable: 50,
      spentHoursNonbillable: 0,
      breakdown: [],
    };
    expect(HarvestSnapshotSchema.parse(valid)).toBeDefined();

    // Add a forbidden monetary key at the top level
    const withTopLevelCost = { ...valid, totalProjectFeesCents: 100 };
    expect(() => HarvestSnapshotSchema.parse(withTopLevelCost)).toThrow();

    // Add a forbidden monetary key inside a person row
    const withPersonCost = {
      ...valid,
      breakdown: [
        {
          taskId: '1',
          taskName: 'Dev',
          taskBudgetHours: null,
          taskSpentHours: 1,
          people: [{ personId: '1', personName: 'X', hours: 1, costCents: 100 }],
        },
      ],
    };
    expect(() => HarvestSnapshotSchema.parse(withPersonCost)).toThrow();

    // Add a forbidden monetary key inside a task row
    const withTaskCost = {
      ...valid,
      breakdown: [
        {
          taskId: '1',
          taskName: 'Dev',
          taskBudgetHours: null,
          taskSpentHours: 1,
          taskCostCents: 1000,
          people: [],
        },
      ],
    };
    expect(() => HarvestSnapshotSchema.parse(withTaskCost)).toThrow();
  });
});
