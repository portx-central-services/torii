import type { TrackerAdapter, ExternalProject, TrackerMetadata } from '@torii/shared';

const MONDAY_API_URL = 'https://api.monday.com/v2';

export class MondayAuthError extends Error {
  constructor(message = 'Monday.com authentication failed') {
    super(message);
    this.name = 'MondayAuthError';
  }
}

export class MondayRateLimitError extends Error {
  constructor(message = 'Monday.com rate limit exceeded') {
    super(message);
    this.name = 'MondayRateLimitError';
  }
}

export interface MondayAdapterConfig {
  workspace: string;
  accessToken: string;
  /** Override for tests. */
  fetchFn?: typeof fetch;
}

interface MondayColumnValue {
  id: string;
  type?: string;
  text?: string | null;
  value?: string | null;
}

interface MondayItem {
  id: string;
  name: string;
  column_values?: MondayColumnValue[];
}

interface MondayBoard {
  id: string;
  name: string;
  items_page?: { items?: MondayItem[] };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

const LIST_BOARDS_QUERY = `
  query ListBoards {
    boards(limit: 50) {
      id
      name
      items_page(limit: 100) {
        items {
          id
          name
          column_values { id type text value }
        }
      }
    }
  }
`;

const GET_ITEM_QUERY = `
  query GetItem($ids: [ID!]!) {
    items(ids: $ids) {
      id
      name
      column_values { id type text value }
    }
  }
`;

function extractTargetGoLive(item: MondayItem): string | undefined {
  for (const col of item.column_values ?? []) {
    const lowerId = col.id.toLowerCase();
    if (!lowerId.includes('go') && !lowerId.includes('target') && !lowerId.includes('date')) {
      continue;
    }
    // For Monday date columns, `text` is the ISO date string when present.
    if (col.text && /^\d{4}-\d{2}-\d{2}$/.test(col.text)) {
      return col.text;
    }
    if (col.value) {
      try {
        const parsed = JSON.parse(col.value) as { date?: string };
        if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
          return parsed.date;
        }
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}

function toExternalProject(item: MondayItem): ExternalProject {
  return {
    externalId: item.id,
    name: item.name,
    targetGoLive: extractTargetGoLive(item),
    raw: item,
  };
}

export class MondayAdapter implements TrackerAdapter {
  private readonly workspace: string;
  private readonly accessToken: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: MondayAdapterConfig) {
    this.workspace = config.workspace;
    this.accessToken = config.accessToken;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await this.fetchFn(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new MondayAuthError();
    }
    if (res.status === 429) {
      throw new MondayRateLimitError();
    }
    if (!res.ok) {
      throw new Error(`Monday.com API error: HTTP ${res.status}`);
    }
    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.errors && body.errors.length > 0) {
      const first = body.errors[0]!;
      const code = (first.extensions?.code as string | undefined) ?? '';
      if (code === 'UserUnauthorizedException' || /unauthor/i.test(first.message)) {
        throw new MondayAuthError(first.message);
      }
      throw new Error(`Monday.com GraphQL error: ${first.message}`);
    }
    if (!body.data) throw new Error('Monday.com returned no data');
    return body.data;
  }

  async listProjects(): Promise<ExternalProject[]> {
    const data = await this.gql<{ boards: MondayBoard[] }>(LIST_BOARDS_QUERY);
    const items: ExternalProject[] = [];
    for (const board of data.boards ?? []) {
      for (const item of board.items_page?.items ?? []) {
        items.push(toExternalProject(item));
      }
    }
    return items;
  }

  async getProject(externalId: string): Promise<ExternalProject | null> {
    const data = await this.gql<{ items: MondayItem[] }>(GET_ITEM_QUERY, {
      ids: [externalId],
    });
    const item = data.items?.[0];
    return item ? toExternalProject(item) : null;
  }

  async getMetadata(): Promise<TrackerMetadata> {
    return {
      provider: 'monday',
      workspace: this.workspace,
      capabilities: { listProjects: true, getProject: true },
    };
  }
}
