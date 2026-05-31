import {
  HarvestSnapshotSchema,
  type ExternalProject,
  type HarvestBreakdownTask,
  type HarvestSnapshot,
  type TrackerAccessCheck,
  type TrackerAccessProbe,
  type TrackerAdapter,
  type TrackerMetadata,
} from '@torii/shared';

const HARVEST_API_BASE = 'https://api.harvestapp.com/v2';
const USER_AGENT = 'Torii (PortX delivery dashboard)';

export class HarvestAuthError extends Error {
  constructor(message = 'Harvest authentication failed') {
    super(message);
    this.name = 'HarvestAuthError';
  }
}

export class HarvestRateLimitError extends Error {
  constructor(message = 'Harvest rate limit exceeded') {
    super(message);
    this.name = 'HarvestRateLimitError';
  }
}

export interface HarvestAdapterConfig {
  /** The Harvest account/workspace short name (e.g., "portx"). Used to build project URLs. */
  workspace: string;
  accessToken: string;
  /** Required on every Harvest API call as the `Harvest-Account-Id` header. */
  accountId: string;
  /** Override for tests. */
  fetchFn?: typeof fetch;
}

interface HarvestProjectRow {
  id: number;
  name: string;
  is_active?: boolean;
  budget?: number | null;
  budget_by?: string | null;
  [key: string]: unknown;
}

interface HarvestProjectsPage {
  projects: HarvestProjectRow[];
  total_pages: number;
  page: number;
}

interface HarvestTaskRef {
  id: number;
  name: string;
}

interface HarvestUserRef {
  id: number;
  name: string;
}

interface HarvestTimeEntryRow {
  id: number;
  hours: number;
  task?: HarvestTaskRef | null;
  user?: HarvestUserRef | null;
  is_archived?: boolean;
  [key: string]: unknown;
}

interface HarvestTimeEntriesPage {
  time_entries: HarvestTimeEntryRow[];
  total_pages: number;
  page: number;
}

interface HarvestBudgetReportRow {
  project_id: number;
  budget?: number | null;
  budget_by?: string | null;
  is_active?: boolean;
  billable_hours?: number;
  non_billable_hours?: number;
  total_hours?: number;
  [key: string]: unknown;
}

interface HarvestBudgetReportPage {
  results: HarvestBudgetReportRow[];
  total_pages: number;
  page: number;
}

interface HarvestMe {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  default_account_id?: number;
  [key: string]: unknown;
}

/**
 * Adapter for Harvest (api.harvestapp.com/v2).
 *
 * Read-only — Harvest is never a source of mergeable project metadata; it powers the
 * Harvest panel + the derived `overBudget` flag. Per design D9, the projected
 * `HarvestSnapshot` is hours-only; cost / invoicing fields from Harvest are dropped
 * during projection (they remain in the verbatim `raw` payload for debugging only).
 */
export class HarvestAdapter implements TrackerAdapter {
  private readonly workspace: string;
  private readonly accessToken: string;
  private readonly accountId: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: HarvestAdapterConfig) {
    this.workspace = config.workspace;
    this.accessToken = config.accessToken;
    this.accountId = config.accountId;
    this.fetchFn = config.fetchFn ?? fetch;
  }

  private async request<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `${HARVEST_API_BASE}${path}`;
    const res = await this.fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Harvest-Account-Id': this.accountId,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new HarvestAuthError();
    }
    if (res.status === 429) {
      throw new HarvestRateLimitError();
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Harvest API error: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
    }
    return (await res.json()) as T;
  }

  async listProjects(): Promise<ExternalProject[]> {
    const items: ExternalProject[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const data = await this.request<HarvestProjectsPage>(
        `/projects?is_active=true&per_page=100&page=${page}`,
      );
      for (const p of data.projects ?? []) {
        items.push({ externalId: String(p.id), name: p.name, raw: p });
      }
      totalPages = data.total_pages || 1;
      page += 1;
    } while (page <= totalPages);
    return items;
  }

  async getProject(externalId: string): Promise<ExternalProject | null> {
    try {
      const p = await this.request<HarvestProjectRow>(`/projects/${externalId}`);
      return { externalId: String(p.id), name: p.name, raw: p };
    } catch (err) {
      if (err instanceof Error && /HTTP 404/.test(err.message)) return null;
      throw err;
    }
  }

  /**
   * Fetch the rich economic snapshot for a single project. Per D9, the projected
   * `HarvestSnapshot` is hours-only — any monetary fields in the Harvest response
   * are dropped before the row is returned. The full raw payload is exposed via
   * the `raw` field for downstream callers that want to retain it for debugging
   * (and pass through to the snapshot row's `raw` JSONB column).
   */
  async getProjectSnapshot(
    externalId: string,
  ): Promise<{ snapshot: HarvestSnapshot; raw: unknown }> {
    // 1. Project metadata (for budget and name).
    const project = await this.request<HarvestProjectRow>(`/projects/${externalId}`);

    // 2. Project-budget report — gives us billable/non-billable totals across the project.
    const budgetReportRow = await this.fetchBudgetReportRow(externalId);

    // 3. Time entries — paged. Aggregates per-(task, person) hours.
    const timeEntries = await this.fetchAllTimeEntries(externalId);
    const breakdown = this.buildBreakdown(timeEntries);

    const spentBillable = budgetReportRow?.billable_hours ?? sum(timeEntries.filter((e) => isBillable(e)).map((e) => e.hours));
    const spentNonbillable =
      budgetReportRow?.non_billable_hours ?? sum(timeEntries.filter((e) => !isBillable(e)).map((e) => e.hours));

    // Harvest's `budget` field on a project carries the budget value; `budget_by` tells us
    // what it's measured in (`task_hours`, `project_hours`, `project_fees`, etc.). We only
    // surface hour-based budgets — when the project is fee-budgeted, we leave it null.
    const budgetHours = isHoursBudget(project.budget_by) && typeof project.budget === 'number' ? project.budget : null;

    const snapshot: HarvestSnapshot = HarvestSnapshotSchema.parse({
      projectId: '', // filled in by the caller (we don't know the Torii project ID here)
      fetchedAt: new Date().toISOString(),
      harvestProjectId: String(project.id),
      harvestProjectUrl: `https://${this.workspace}.harvestapp.com/projects/${project.id}`,
      budgetHours,
      spentHoursBillable: Number(spentBillable.toFixed(2)),
      spentHoursNonbillable: Number(spentNonbillable.toFixed(2)),
      breakdown,
    });

    // `raw` retains the full Harvest payload for debugging. NEVER exposed via API/UI.
    const raw = { project, budgetReport: budgetReportRow, timeEntries };
    return { snapshot, raw };
  }

  private async fetchBudgetReportRow(externalId: string): Promise<HarvestBudgetReportRow | null> {
    // The project-budget report doesn't support filtering by project_id directly in v2;
    // it returns all active projects. For a single project, we filter the result client-side.
    // For workspaces with hundreds of projects this is still a small payload (~1 row per project).
    let page = 1;
    let totalPages = 1;
    const targetId = Number(externalId);
    do {
      const data = await this.request<HarvestBudgetReportPage>(
        `/reports/project_budget?page=${page}&per_page=100`,
      );
      for (const row of data.results ?? []) {
        if (row.project_id === targetId) return row;
      }
      totalPages = data.total_pages || 1;
      page += 1;
    } while (page <= totalPages);
    return null;
  }

  private async fetchAllTimeEntries(externalId: string): Promise<HarvestTimeEntryRow[]> {
    const all: HarvestTimeEntryRow[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const data = await this.request<HarvestTimeEntriesPage>(
        `/time_entries?project_id=${externalId}&per_page=100&page=${page}`,
      );
      all.push(...(data.time_entries ?? []));
      totalPages = data.total_pages || 1;
      page += 1;
    } while (page <= totalPages);
    return all;
  }

  /**
   * Aggregate time entries into a per-(task, person) breakdown.
   *
   * The projection deliberately omits every cost/fee key returned by Harvest — even when
   * the source rows include `billable_rate` or similar, those values are dropped here
   * before they reach the snapshot row. `HarvestSnapshotSchema.parse` enforces this at
   * the type-system level via `.strict()` (defense-in-depth for D9).
   */
  private buildBreakdown(entries: HarvestTimeEntryRow[]): HarvestBreakdownTask[] {
    const taskMap = new Map<string, { name: string; people: Map<string, { name: string; hours: number; archived: boolean }> }>();
    for (const e of entries) {
      const taskId = String(e.task?.id ?? 'unknown');
      const taskName = e.task?.name ?? 'Unknown task';
      const personId = String(e.user?.id ?? 'unknown');
      const personName = e.user?.name ?? 'Unknown person';
      const archived = Boolean(e.is_archived);
      if (!taskMap.has(taskId)) taskMap.set(taskId, { name: taskName, people: new Map() });
      const task = taskMap.get(taskId)!;
      if (!task.people.has(personId)) task.people.set(personId, { name: personName, hours: 0, archived });
      const person = task.people.get(personId)!;
      person.hours += e.hours;
      if (archived) person.archived = true;
    }
    return [...taskMap.entries()].map(([taskId, t]) => ({
      taskId,
      taskName: t.name,
      taskBudgetHours: null, // Harvest's task-level budget isn't reliably exposed per project; future enhancement
      taskSpentHours: Number([...t.people.values()].reduce((acc, p) => acc + p.hours, 0).toFixed(2)),
      people: [...t.people.entries()].map(([personId, p]) => ({
        personId,
        personName: p.name,
        hours: Number(p.hours.toFixed(2)),
        ...(p.archived ? { archived: true } : {}),
      })),
    }));
  }

  async getMetadata(): Promise<TrackerMetadata> {
    return {
      provider: 'harvest',
      workspace: this.workspace,
      capabilities: { listProjects: true, getProject: true },
    };
  }

  async verifyAccess(): Promise<TrackerAccessCheck> {
    const probes: TrackerAccessProbe[] = [];

    let identity: TrackerAccessCheck['identity'] | undefined;
    try {
      const me = await this.request<HarvestMe>('/users/me');
      const name = [me.first_name, me.last_name].filter(Boolean).join(' ').trim() || me.email;
      identity = {
        id: String(me.id),
        ...(name ? { name } : {}),
        ...(me.email ? { email: me.email } : {}),
        ...(me.default_account_id ? { account: { id: String(me.default_account_id), slug: this.workspace } } : {}),
      };
      probes.push({ name: 'me', ok: true, detail: me.email ? `Authenticated as ${me.email}` : 'Authenticated' });
    } catch (err) {
      probes.push({ name: 'me', ok: false, error: err instanceof Error ? err.message : String(err) });
    }

    let sampleProjectId: string | null = null;
    try {
      const data = await this.request<HarvestProjectsPage>('/projects?is_active=true&per_page=1&page=1');
      const first = data.projects?.[0];
      sampleProjectId = first ? String(first.id) : null;
      probes.push({
        name: 'projects:list',
        ok: true,
        detail: `Returned ${data.projects?.length ?? 0} project(s) (page 1 of ${data.total_pages ?? 1})`,
      });
    } catch (err) {
      probes.push({ name: 'projects:list', ok: false, error: err instanceof Error ? err.message : String(err) });
    }

    if (sampleProjectId) {
      try {
        await this.getProjectSnapshot(sampleProjectId);
        probes.push({ name: 'snapshot:read', ok: true, detail: `Read snapshot for project ${sampleProjectId}` });
      } catch (err) {
        probes.push({ name: 'snapshot:read', ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      probes.push({ name: 'snapshot:read', ok: true, detail: 'No projects available to sample (skipped)' });
    }

    const ok = probes.every((p) => p.ok);
    return { ok, identity, probes };
  }
}

function sum(xs: number[]): number {
  return xs.reduce((acc, x) => acc + x, 0);
}

function isBillable(entry: HarvestTimeEntryRow): boolean {
  // Harvest time entries carry `billable: boolean` when expanded; default to true to match
  // Harvest's typical billable-by-default project setup.
  const v = (entry as { billable?: boolean }).billable;
  return v === undefined ? true : v === true;
}

function isHoursBudget(budgetBy: string | null | undefined): boolean {
  if (!budgetBy) return false;
  // Harvest budget_by values: 'project', 'project_cost', 'task', 'person', 'project_fees', 'none'.
  // Hours-based: 'project', 'task', 'person'. Cost/fees-based: 'project_cost', 'project_fees'.
  return budgetBy === 'project' || budgetBy === 'task' || budgetBy === 'person';
}
