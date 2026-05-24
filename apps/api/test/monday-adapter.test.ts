import { describe, it, expect, vi } from 'vitest';
import {
  MondayAdapter,
  MondayAuthError,
  MondayRateLimitError,
} from '../src/sync/monday/MondayAdapter.js';

function mkResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MondayAdapter', () => {
  it('listProjects flattens items across boards', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mkResponse(200, {
        data: {
          boards: [
            {
              id: '1',
              name: 'Board A',
              items_page: {
                items: [
                  {
                    id: '101',
                    name: 'Acme integration',
                    column_values: [
                      { id: 'go_live_date', type: 'date', text: '2026-09-01', value: null },
                    ],
                  },
                ],
              },
            },
            {
              id: '2',
              name: 'Board B',
              items_page: {
                items: [{ id: '202', name: 'Beta launch', column_values: [] }],
              },
            },
          ],
        },
      }),
    );
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const items = await adapter.listProjects();
    expect(items).toEqual([
      {
        externalId: '101',
        name: 'Acme integration',
        targetGoLive: '2026-09-01',
        raw: expect.any(Object),
      },
      {
        externalId: '202',
        name: 'Beta launch',
        targetGoLive: undefined,
        raw: expect.any(Object),
      },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.monday.com/v2',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'tok' }),
      }),
    );
  });

  it('extracts targetGoLive from column value JSON when text is empty', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mkResponse(200, {
        data: {
          boards: [
            {
              id: '1',
              name: 'B',
              items_page: {
                items: [
                  {
                    id: '1',
                    name: 'X',
                    column_values: [
                      {
                        id: 'target_date',
                        type: 'date',
                        text: null,
                        value: '{"date":"2026-10-15"}',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const items = await adapter.listProjects();
    expect(items[0]!.targetGoLive).toBe('2026-10-15');
  });

  it('prefers the project column value over item name when present', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mkResponse(200, {
        data: {
          boards: [
            {
              id: '1',
              name: 'B',
              items_page: {
                items: [
                  {
                    id: '1',
                    name: 'Fallback Item Name',
                    column_values: [
                      {
                        id: 'project',
                        type: 'text',
                        text: 'Imported Monday Project Name',
                        value: '"Imported Monday Project Name"',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const items = await adapter.listProjects();
    expect(items[0]!.name).toBe('Imported Monday Project Name');
  });

  it('uses generated project-name style ids and JSON string column values', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mkResponse(200, {
        data: {
          boards: [
            {
              id: '1',
              name: 'B',
              items_page: {
                items: [
                  {
                    id: '1',
                    name: 'Fallback Item Name',
                    column_values: [
                      {
                        id: 'text_project_name_ab12cd34',
                        type: 'text',
                        text: '',
                        value: '"Project Name From JSON"',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const items = await adapter.listProjects();
    expect(items[0]!.name).toBe('Project Name From JSON');
  });

  it('uses column title Project Name when id is opaque', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mkResponse(200, {
        data: {
          boards: [
            {
              id: '1',
              name: 'B',
              items_page: {
                items: [
                  {
                    id: '1',
                    name: 'Fallback Item Name',
                    column_values: [
                      {
                        id: 'text_mks8w3nq',
                        column: { id: 'text_mks8w3nq', title: 'Project Name' },
                        type: 'text',
                        text: 'Project Name From Column Title',
                        value: '"Project Name From Column Title"',
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const items = await adapter.listProjects();
    expect(items[0]!.name).toBe('Project Name From Column Title');
  });

  it('throws MondayAuthError on 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(adapter.listProjects()).rejects.toBeInstanceOf(MondayAuthError);
  });

  it('throws MondayAuthError on UserUnauthorizedException in GraphQL errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mkResponse(200, {
        errors: [
          { message: 'unauthorized', extensions: { code: 'UserUnauthorizedException' } },
        ],
      }),
    );
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(adapter.listProjects()).rejects.toBeInstanceOf(MondayAuthError);
  });

  it('throws MondayRateLimitError on 429', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(adapter.listProjects()).rejects.toBeInstanceOf(MondayRateLimitError);
  });

  it('retries listProjects with a minimal query on unauthorized field/type', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        mkResponse(200, {
          errors: [
            {
              message: 'Unauthorized field or type',
              extensions: { code: 'UserUnauthorizedException' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mkResponse(200, {
          data: {
            boards: [
              {
                id: '1',
                name: 'Board A',
                items_page: {
                  items: [{ id: '101', name: 'Acme integration' }],
                },
              },
            ],
          },
        }),
      );
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const items = await adapter.listProjects();

    expect(items).toEqual([
      {
        externalId: '101',
        name: 'Acme integration',
        targetGoLive: undefined,
        raw: expect.any(Object),
      },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries getProject with a minimal query on unauthorized field/type', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        mkResponse(200, {
          errors: [
            {
              message: 'Unauthorized field or type',
              extensions: { code: 'UserUnauthorizedException' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mkResponse(200, {
          data: {
            items: [{ id: '101', name: 'Acme integration' }],
          },
        }),
      );
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const item = await adapter.getProject('101');

    expect(item).toEqual({
      externalId: '101',
      name: 'Acme integration',
      targetGoLive: undefined,
      raw: expect.any(Object),
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('getProject returns null when the item is not found', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mkResponse(200, { data: { items: [] } }));
    const adapter = new MondayAdapter({
      workspace: 'w',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(await adapter.getProject('missing')).toBeNull();
  });

  it('getMetadata returns provider, workspace, and capabilities', async () => {
    const adapter = new MondayAdapter({ workspace: 'acme', accessToken: 'tok' });
    expect(await adapter.getMetadata()).toEqual({
      provider: 'monday',
      workspace: 'acme',
      capabilities: { listProjects: true, getProject: true },
    });
  });
});
