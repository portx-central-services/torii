import {
  PHASES,
  phaseLabel,
  type ExternalProject,
  type Phase,
  type TrackerAccessCheck,
  type TrackerAccessProbe,
  type TrackerAdapter,
  type TrackerMetadata,
} from '@torii/shared';

const MONDAY_API_URL = 'https://api.monday.com/v2';
// Version that exposes `display_value` on MirrorValue/BoardRelationValue column types.
const MONDAY_API_VERSION = '2024-10';

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
  column?: { id?: string; title?: string };
  type?: string;
  text?: string | null;
  value?: string | null;
  /** Present only on mirror/board_relation columns; the human-readable value. */
  display_value?: string | null;
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
  errors?: Array<{
    message: string;
    path?: Array<string | number>;
    extensions?: Record<string, unknown>;
  }>;
}

// Single source of truth for the column_values selection. BOTH the board-listing
// query and the per-item query MUST use this so bulk sync and per-item sync/import
// always return identical column data. When adding fields (e.g., a new column type's
// `display_value`), edit this one constant — never inline a selection in a query.
const COLUMN_VALUES_SELECTION = `
  column_values {
    id type text value column { id title }
    ... on MirrorValue { display_value }
    ... on BoardRelationValue { display_value }
  }
`;

const LIST_BOARDS_QUERY = `
  query ListBoards {
    boards(limit: 50) {
      id
      name
      items_page(limit: 100) {
        items {
          id
          name
          ${COLUMN_VALUES_SELECTION}
        }
      }
    }
  }
`;

const LIST_BOARDS_QUERY_MIN = `
  query ListBoardsMin {
    boards(limit: 50) {
      id
      name
      items_page(limit: 100) {
        items {
          id
          name
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
      ${COLUMN_VALUES_SELECTION}
    }
  }
`;

const GET_ITEM_QUERY_MIN = `
  query GetItemMin($ids: [ID!]!) {
    items(ids: $ids) {
      id
      name
    }
  }
`;

function isUnauthorizedFieldOrTypeError(err: unknown): boolean {
  if (!(err instanceof MondayAuthError)) return false;
  return /queried fields\/types|unauthorized field or type/i.test(err.message);
}

/**
 * Monday column title → `keyDates.<key>`. The Monday board titles are inconsistent
 * ("Baseline Go-live" vs "Expected Go-Live Date") so the map uses exact titles as
 * they appear in the live workspace.
 *
 * `hypercare_end` has no Monday source — it stays Torii-owned and is derived
 * downstream when not explicitly set.
 */
const MONDAY_KEY_DATE_TITLE_MAP: Record<string, string> = {
  // "Project Add Date" is when the project enters PMO tracking — that's the kickoff.
  'Project Add Date': 'kickoff',
  // "Project Start Date" is when active delivery work begins (post-intake). Distinct from kickoff.
  'Project Start Date': 'project_start',
  'UAT Start Date': 'uat_start',
  'Baseline Go-live': 'baseline_go_live',
  'Expected Go-Live Date': 'target_go_live',
  'Actual Go-Live Date': 'actual_go_live',
};

/** Pull an ISO yyyy-mm-dd date from a Monday date column, preferring `text` over JSON-encoded `value.date`. */
function readDateColumn(col: MondayColumnValue): string | undefined {
  if (col.text && /^\d{4}-\d{2}-\d{2}$/.test(col.text)) return col.text;
  if (col.value) {
    try {
      const parsed = JSON.parse(col.value) as { date?: string };
      if (parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) return parsed.date;
    } catch {
      // ignore malformed JSON
    }
  }
  return undefined;
}

/**
 * The Monday board column title that holds the project phase. The column is a status
 * column whose labels are formatted `[N] Name` (e.g., `[4] Development`).
 */
const MONDAY_PHASE_COLUMN_TITLE = 'Project Phase';

/**
 * Map a Monday "Project Phase" cell value to a Torii `Phase`. Resolution order:
 *   1. If the value contains a leading bracketed number (`[1]`..`[7]`), use that as
 *      a 1-based index into `PHASES`. This is the most robust match because it
 *      survives label edits like "Go-Live Readiness" vs "Go Live Readiness".
 *   2. Otherwise compare the cleaned text (stripped of any bracket prefix) against
 *      every phase's display label, case-insensitively.
 *   3. Return undefined if neither matches — the adapter MUST NOT guess.
 */
function parseMondayPhase(rawValue: string): Phase | undefined {
  const v = rawValue.trim();
  if (!v) return undefined;
  const bracketMatch = v.match(/^\[(\d+)\]/);
  if (bracketMatch) {
    const n = Number.parseInt(bracketMatch[1]!, 10);
    if (n >= 1 && n <= PHASES.length) return PHASES[n - 1];
  }
  const cleaned = v.replace(/^\[\d+\]\s*/, '').toLowerCase();
  for (const phase of PHASES) {
    if (phaseLabel(phase).toLowerCase() === cleaned) return phase;
  }
  return undefined;
}

/** Extract the project phase from the Monday "Project Phase" column. */
function extractPhase(item: MondayItem): Phase | undefined {
  for (const col of item.column_values ?? []) {
    if (col.column?.title !== MONDAY_PHASE_COLUMN_TITLE) continue;
    const raw = col.display_value?.trim() || col.text?.trim();
    if (!raw) return undefined;
    return parseMondayPhase(raw);
  }
  return undefined;
}

/** Extract every recognized key-date column for the item. Empty values are omitted. */
function extractKeyDates(item: MondayItem): NonNullable<ExternalProject['keyDates']> {
  const out: NonNullable<ExternalProject['keyDates']> = {};
  for (const col of item.column_values ?? []) {
    const title = col.column?.title;
    if (!title) continue;
    const key = MONDAY_KEY_DATE_TITLE_MAP[title] as keyof NonNullable<ExternalProject['keyDates']> | undefined;
    if (!key) continue;
    const date = readDateColumn(col);
    if (date) out[key] = date;
  }
  return out;
}

/** Monday board column title → Torii `details.<key>`. Confirmed against live synced data. */
const MONDAY_COLUMN_TITLE_MAP: Record<string, string> = {
  'Project Manager': 'project_manager',
  'Solution Architect': 'solution_architect',
  'Senior Consultant': 'solution_consultant',
  'Core Solution': 'core_solution',
  Core: 'core_vendor',
  'Status Report': 'status_report_url',
  Jira: 'jira_project_url',
  'Customer Type': 'customer_type',
  'Finance - Use Case': 'finance_use_case',
  'Use Case - Group': 'use_case_group',
  'Customer Status': 'customer_status',
};

const URL_DETAIL_KEYS = new Set(['status_report_url', 'jira_project_url']);

/** First http(s) URL token in a string, or undefined. */
function firstUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : undefined;
}

/**
 * Map recognized Monday columns to `details.*` values. Link columns yield the
 * extracted URL; other columns yield trimmed text. Empty values are omitted.
 *
 * `details.fintech_parent` is handled by a separate explicit precedence pass
 * (see below) because two related Monday columns ("Fintech Parent" and "Fintech")
 * both map to the same key — see design D6.
 */
function extractDetails(item: MondayItem): Record<string, string> {
  const details: Record<string, string> = {};
  for (const col of item.column_values ?? []) {
    const title = col.column?.title;
    if (!title) continue;
    const key = MONDAY_COLUMN_TITLE_MAP[title];
    if (!key) continue;
    // Mirror/board_relation columns expose their value via display_value; all
    // others (text, link, status, ...) use text.
    const raw = col.display_value?.trim() || col.text?.trim();
    if (!raw) continue;
    if (URL_DETAIL_KEYS.has(key)) {
      const url = firstUrl(raw);
      if (url) details[key] = url;
    } else {
      details[key] = raw;
    }
  }
  // Fintech Parent / Fintech: PortX's Monday board has two related columns;
  // "Fintech Parent" is preferred but occasionally only "Fintech" is set.
  // Explicit precedence so the outcome is deterministic regardless of column
  // iteration order (design D6). Both columns are text — no URL extraction.
  const fintechParent = readNonEmptyColumn(item, 'Fintech Parent');
  const fintech = fintechParent ?? readNonEmptyColumn(item, 'Fintech');
  if (fintech) details.fintech_parent = fintech;
  return details;
}

/** Look up a column by title and return its trimmed display_value/text, or undefined when absent or empty. */
function readNonEmptyColumn(item: MondayItem, title: string): string | undefined {
  for (const col of item.column_values ?? []) {
    if (col.column?.title !== title) continue;
    const raw = col.display_value?.trim() || col.text?.trim();
    if (raw) return raw;
  }
  return undefined;
}

function extractProjectName(item: MondayItem): string {
  for (const col of item.column_values ?? []) {
    const lowerId = col.id.toLowerCase();
    const lowerTitle = col.column?.title?.toLowerCase() ?? '';
    const looksLikeProjectName =
      lowerId === 'project' ||
      lowerId === 'project_name' ||
      (lowerId.includes('project') && lowerId.includes('name')) ||
      (lowerTitle.includes('project') && lowerTitle.includes('name'));
    if (!looksLikeProjectName) continue;
    const text = col.text?.trim();
    if (text) return text;

    if (col.value) {
      try {
        const parsed = JSON.parse(col.value) as
          | string
          | { text?: string; label?: string; value?: string };
        if (typeof parsed === 'string' && parsed.trim().length > 0) {
          return parsed.trim();
        }
        const fallback = parsed.text ?? parsed.label ?? parsed.value;
        if (typeof fallback === 'string' && fallback.trim().length > 0) {
          return fallback.trim();
        }
      } catch {
        // ignore malformed column JSON
      }
    }
  }
  return item.name;
}

function toExternalProject(item: MondayItem): ExternalProject {
  const details = extractDetails(item);
  const keyDates = extractKeyDates(item);
  const phase = extractPhase(item);
  return {
    externalId: item.id,
    name: extractProjectName(item),
    ...(phase ? { phase } : {}),
    ...(Object.keys(keyDates).length > 0 ? { keyDates } : {}),
    ...(Object.keys(details).length > 0 ? { details } : {}),
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
        // Pin a version that exposes display_value on MirrorValue/BoardRelationValue.
        'API-Version': MONDAY_API_VERSION,
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
        if (/unauthorized field or type/i.test(first.message)) {
          const path = first.path?.join('.') ?? 'unknown';
          throw new MondayAuthError(
            `Monday API denied access to one or more queried fields/types (path: ${path}, code: ${code || 'n/a'}). Original: "${first.message}". Ensure the app has board/item read scopes and the connected user can access the target boards/items.`,
          );
        }
        throw new MondayAuthError(first.message);
      }
      throw new Error(`Monday.com GraphQL error: ${first.message}`);
    }
    if (!body.data) throw new Error('Monday.com returned no data');
    return body.data;
  }

  async listProjects(): Promise<ExternalProject[]> {
    let data: { boards: MondayBoard[] };
    try {
      data = await this.gql<{ boards: MondayBoard[] }>(LIST_BOARDS_QUERY);
    } catch (err) {
      if (!isUnauthorizedFieldOrTypeError(err)) throw err;
      data = await this.gql<{ boards: MondayBoard[] }>(LIST_BOARDS_QUERY_MIN);
    }
    const items: ExternalProject[] = [];
    for (const board of data.boards ?? []) {
      for (const item of board.items_page?.items ?? []) {
        items.push(toExternalProject(item));
      }
    }
    return items;
  }

  async getProject(externalId: string): Promise<ExternalProject | null> {
    let data: { items: MondayItem[] };
    let usedFallbackQuery = false;
    try {
      data = await this.gql<{ items: MondayItem[] }>(GET_ITEM_QUERY, {
        ids: [externalId],
      });
    } catch (err) {
      if (!isUnauthorizedFieldOrTypeError(err)) throw err;
      usedFallbackQuery = true;
      data = await this.gql<{ items: MondayItem[] }>(GET_ITEM_QUERY_MIN, {
        ids: [externalId],
      });
    }
    const item = data.items?.[0];
    if (process.env.NODE_ENV !== 'test') {
      const columns = item?.column_values ?? [];
      const projectNameCandidates = columns
        .map((c) => ({ id: c.id, title: c.column?.title ?? null, text: c.text ?? null }))
        .filter((c) => {
          const id = c.id.toLowerCase();
          const title = c.title?.toLowerCase() ?? '';
          return (
            id === 'project' ||
            id === 'project_name' ||
            (id.includes('project') && id.includes('name')) ||
            (title.includes('project') && title.includes('name'))
          );
        });

      // Flag mapped column titles that did not appear on the item (possible board drift).
      const presentTitles = new Set(columns.map((c) => c.column?.title).filter(Boolean));
      const missingMappedTitles = Object.keys(MONDAY_COLUMN_TITLE_MAP).filter(
        (title) => !presentTitles.has(title),
      );

      console.info('[MondayAdapter.getProject]', {
        externalId,
        usedFallbackQuery,
        foundItem: Boolean(item),
        columnCount: columns.length,
        projectNameCandidates,
        resolvedName: item ? extractProjectName(item) : null,
        resolvedDetails: item ? extractDetails(item) : null,
        missingMappedTitles,
      });
    }
    return item ? toExternalProject(item) : null;
  }

  async getMetadata(): Promise<TrackerMetadata> {
    return {
      provider: 'monday',
      workspace: this.workspace,
      capabilities: { listProjects: true, getProject: true },
    };
  }

  async verifyAccess(): Promise<TrackerAccessCheck> {
    const probes: TrackerAccessProbe[] = [];

    let identity: TrackerAccessCheck['identity'] | undefined;
    try {
      const meData = await this.gql<{
        me: {
          id?: string;
          name?: string;
          email?: string;
          account?: { id?: string; name?: string; slug?: string };
        };
      }>(`query Me { me { id name email account { id name slug } } }`);
      identity = meData.me;
      probes.push({
        name: 'me',
        ok: true,
        detail: meData.me?.email
          ? `Authenticated as ${meData.me.email}`
          : 'Authenticated',
      });
    } catch (err) {
      probes.push({
        name: 'me',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const boardsData = await this.gql<{ boards: Array<{ id: string }> }>(
        `query BoardsPing { boards(limit: 1) { id } }`,
      );
      probes.push({
        name: 'boards:list',
        ok: true,
        detail: `Returned ${boardsData.boards?.length ?? 0} board(s)`,
      });
    } catch (err) {
      probes.push({
        name: 'boards:list',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const colData = await this.gql<{
        boards: Array<{
          items_page?: {
            items?: Array<{ column_values?: Array<{ id: string }> }>;
          };
        }>;
      }>(
        `query BoardItemsPing {
          boards(limit: 1) {
            items_page(limit: 1) {
              items { id column_values { id type } }
            }
          }
        }`,
      );
      const sampleItem = colData.boards?.[0]?.items_page?.items?.[0];
      const colCount = sampleItem?.column_values?.length ?? 0;
      probes.push({
        name: 'items:read-columns',
        ok: true,
        detail: sampleItem
          ? `Read ${colCount} column value(s) from a sample item`
          : 'No items found to sample (read permission appears to work)',
      });
    } catch (err) {
      probes.push({
        name: 'items:read-columns',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const ok = probes.every((p) => p.ok);
    return { ok, identity, probes };
  }
}
