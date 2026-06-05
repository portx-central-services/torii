import type {
  CustomerListItem,
  CustomerReconciliation,
  DashboardSummary,
  HarvestClientListItem,
  InsightsOverview,
  MyWeekProject,
  PeopleOverviewRow,
  Phase,
  ProjectState,
  RisksWithStale,
  Role,
  StaleRiskRow,
  WorkloadResponse,
  WorkloadUpdate,
} from '@torii/shared';
import { api } from './client.js';

export type {
  CustomerListItem,
  CustomerReconciliation,
  DashboardSummary,
  HarvestClientListItem,
  InsightsOverview,
  MyWeekProject,
  PeopleOverviewRow,
  RisksWithStale,
  StaleRiskRow,
  WorkloadResponse,
  WorkloadRow,
  WorkloadUpdate,
} from '@torii/shared';

export interface MeResponse {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    role: Role;
    isAdmin: boolean;
  };
}

export interface AuthConfig {
  providers: Array<'keycloak'>;
}

/** Display order of the detail-field subgroups on the project detail page. */
export const PROJECT_DETAIL_GROUPS = ['Team', 'Customer', 'Systems', 'Use case', 'Links'] as const;

export type ProjectDetailGroup = (typeof PROJECT_DETAIL_GROUPS)[number];

export const PROJECT_DETAIL_FIELDS = [
  { key: 'project_manager', label: 'Project Manager', group: 'Team' },
  { key: 'solution_architect', label: 'Solution Architect', group: 'Team' },
  { key: 'solution_consultant', label: 'Senior Consultant', group: 'Team' },
  { key: 'customer_type', label: 'Customer Type', group: 'Customer' },
  { key: 'customer_status', label: 'Customer Status', group: 'Customer' },
  { key: 'primary_contact', label: 'Primary Contact', group: 'Customer' },
  { key: 'core_solution', label: 'Core Solution', group: 'Systems' },
  { key: 'core_vendor', label: 'Core Vendor', group: 'Systems' },
  { key: 'finance_use_case', label: 'Finance - Use Case', group: 'Use case' },
  { key: 'use_case_group', label: 'Use Case - Group', group: 'Use case' },
  { key: 'status_report_url', label: 'Status Report', group: 'Links', isLink: true },
  { key: 'jira_project_url', label: 'Jira Project', group: 'Links', isLink: true },
] as const;

export type ProjectDetailField = (typeof PROJECT_DETAIL_FIELDS)[number];
export type ProjectDetailKey = ProjectDetailField['key'];

export type ProjectDetails = Partial<Record<ProjectDetailKey, string>>;

/** The detail fields bucketed by group, in `PROJECT_DETAIL_GROUPS` order. */
export const PROJECT_DETAIL_FIELD_GROUPS: ReadonlyArray<{
  group: ProjectDetailGroup;
  fields: ReadonlyArray<ProjectDetailField>;
}> = PROJECT_DETAIL_GROUPS.map((group) => ({
  group,
  fields: PROJECT_DETAIL_FIELDS.filter((f) => f.group === group),
}));

/** Detail columns hidden by default until the user opts to show them. */
export const DEFAULT_HIDDEN_DETAIL_COLUMNS: ProjectDetailKey[] = [
  'solution_consultant',
  'primary_contact',
  'status_report_url',
  'jira_project_url',
  'customer_type',
  'finance_use_case',
  'use_case_group',
  'customer_status',
];

export const PROJECT_TYPES = ['direct', 'fintech'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const RAG_LEVELS = ['Red', 'Amber', 'Green'] as const;
export type RagLevel = (typeof RAG_LEVELS)[number];

export const RISK_TYPES = [
  'Technical',
  'Relationship',
  'Schedule',
  'ExternalDependency',
  'Gap',
  'Resourcing',
] as const;
export type RiskType = (typeof RISK_TYPES)[number];

export const RISK_STATES = ['Blocked', 'Inform'] as const;
export type RiskState = (typeof RISK_STATES)[number];

export interface Project {
  id: string;
  name: string;
  phase: Phase;
  state: ProjectState;
  keyDates: {
    kickoff?: string;
    project_start?: string;
    uat_start?: string;
    baseline_go_live?: string;
    target_go_live?: string;
    actual_go_live?: string;
    hypercare_end?: string;
  };
  details: ProjectDetails;
  /** Derived from `details.fintech_parent`; read-only on the API. */
  projectType: ProjectType;
  /** Customer that owns this project. Null when not yet mapped. */
  customerId: string | null;
  /** Resolved customer row when included; null otherwise. */
  customer: { id: string; name: string } | null;
  /** Derived from pinned Harvest projects (Σ spent > Σ budget). False when no Harvest project is pinned. */
  overBudget: boolean;
  /** Sum of budget hours across pinned Harvest projects. Null when no pinned row has a budget. */
  budgetHours: number | null;
  /** Sum of (billable + non-billable) spent hours across pinned Harvest projects. Null when no pinned rows. */
  spentHours: number | null;
  ownerId: string | null;
  /** Resolved Person rows. Null when the FK isn't set; UI falls back to `details.*`. */
  projectManager: Person | null;
  solutionArchitect: Person | null;
  solutionConsultant: Person | null;
  /** Additional individuals beyond the FK primary, parsed from `details.<role>`
   *  comma-separated lists. The schema has one FK slot per role; multi-person
   *  Monday assignments overflow into these arrays so UI can render all names. */
  roleSecondaries: {
    projectManager: Array<{ id: string; name: string }>;
    solutionArchitect: Array<{ id: string; name: string }>;
    solutionConsultant: Array<{ id: string; name: string }>;
  };
  trackerRef: { provider: string; externalId: string } | null;
  fieldMapping: Record<string, 'torii' | 'monday'>;
  createdAt: string;
  updatedAt: string;
}


export interface RiskListItem {
  projectId: string;
  projectName: string;
  /** Customer the project belongs to. Null when the project isn't mapped yet. */
  customerId: string | null;
  customerName: string | null;
  weekOf: string;
  ragLevel: RagLevel;
  riskTypes: RiskType[];
  state: RiskState;
  title: string;
}

export interface ProjectRiskUpdate {
  id: string;
  projectId: string;
  weekOf: string;
  ragLevel: RagLevel;
  riskTypes: RiskType[];
  state: RiskState;
  description: string;
  goToGreenPlan: string;
  latestUpdate: string;
  nextSteps: string;
  actionRequested: string;
  authorId: string;
  authorName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRiskUpdateUpsert {
  ragLevel: RagLevel;
  riskTypes: RiskType[];
  state: RiskState;
  description?: string;
  goToGreenPlan?: string;
  latestUpdate?: string;
  nextSteps?: string;
  actionRequested?: string;
}

export interface UserPreferences {
  hiddenProjectColumns: string[];
}

export interface MondayItemSnapshot {
  id?: string;
  name?: string;
  column_values?: Array<{
    id: string;
    type?: string;
    text?: string | null;
    value?: string | null;
    column?: { id?: string; title?: string };
  }>;
}

export interface ProjectDetail extends Project {
  allocations: Array<{
    id: string;
    projectId: string;
    personId: string;
    pct: number;
    start: string;
    end: string;
  }>;
  lastSyncedAt: string | null;
  trackerRaw: MondayItemSnapshot | null;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  role: Role;
  defaultCapacityPct: number;
  isAdmin: boolean;
  /** Harvest user-ID bridge. Null until an admin links the Person on /trackers. */
  harvestUserId: string | null;
}

export interface PersonAllocation {
  id: string;
  projectId: string;
  personId: string;
  pct: number;
  start: string;
  end: string;
  project: { name: string; phase: Phase; state: ProjectState };
}

export interface CapacityRollup {
  from: string;
  to: string;
  weeks: Array<{
    weekStart: string;
    weekEnd: string;
    projects: Array<{ projectId: string; projectName: string; demandPct: number }>;
    people: Array<{
      personId: string;
      personName: string;
      committedPct: number;
      defaultCapacityPct: number;
      overAllocated: boolean;
    }>;
  }>;
}

export interface TrackerConnection {
  id: string;
  provider: string;
  workspace: string;
  status: 'ok' | 'auth_failed' | 'rate_limited';
  lastSyncedAt: string | null;
  createdAt: string;
}

export const endpoints = {
  me: () => api.get<MeResponse>('/api/me'),
  authConfig: () => api.get<AuthConfig>('/api/auth/config'),
  signout: () =>
    api.post<{ ok: true; endSessionUrl: string | null }>('/api/auth/signout'),

  listProjects: (filters: { phase?: Phase; state?: ProjectState; owner?: string; sort?: string }) =>
    api.get<Project[]>('/api/projects', filters as Record<string, string | undefined>),
  getProject: (id: string) => api.get<ProjectDetail>(`/api/projects/${id}`),
  createProject: (body: { name: string; phase?: Phase; state?: ProjectState; keyDates?: Record<string, string> }) =>
    api.post<Project>('/api/projects', body),
  updateProject: (
    id: string,
    body: Partial<{
      name: string;
      phase: Phase;
      state: ProjectState;
      keyDates: Record<string, string>;
      details: ProjectDetails;
    }>,
  ) => api.patch<Project>(`/api/projects/${id}`, body),

  listPeople: () => api.get<Person[]>('/api/people'),
  getPerson: (id: string) => api.get<Person>(`/api/people/${id}`),
  personAllocations: (id: string, from: string, to: string) =>
    api.get<PersonAllocation[]>(`/api/people/${id}/allocations`, { from, to }),
  /** Every project this person holds a role on (owner / pm / sa / sc). Same project may appear multiple times. */
  /** Every role association — owner/PM/SA/SC — for this person, across both
   *  FK-primary and details-secondary (multi-person Monday columns).
   *  `last30DaysHours` is this person's Harvest hours on that project over the
   *  trailing 30 days; null when the person isn't Harvest-linked. */
  personProjects: (id: string) =>
    api.get<Array<{ role: 'owner' | 'pm' | 'sa' | 'sc'; primary: boolean; last30DaysHours: number | null; project: Project }>>(`/api/people/${id}/projects`),
  /** Per-project Allocations-vs-Actuals reconciliation rows for this Person. */
  personReconciliation: (id: string) =>
    api.get<PersonReconciliationRow[]>(`/api/people/${id}/reconciliation`),

  listHarvestUsers: () =>
    api.get<HarvestUserListItem[]>('/api/tracker/harvest/users'),
  linkPersonToHarvestUser: (personId: string, harvestUserId: string) =>
    api.post<{ ok: true }>(`/api/people/${personId}/harvest-link`, { harvestUserId }),
  unlinkPersonHarvestUser: (personId: string) =>
    api.delete<void>(`/api/people/${personId}/harvest-link`),

  createAllocation: (body: { projectId: string; personId: string; pct: number; start: string; end: string }) =>
    api.post<{ id: string }>('/api/allocations', body),
  updateAllocation: (id: string, body: Partial<{ pct: number; start: string; end: string }>) =>
    api.patch<{ id: string }>(`/api/allocations/${id}`, body),
  deleteAllocation: (id: string) => api.delete<void>(`/api/allocations/${id}`),

  capacityRollup: (from: string, to: string) =>
    api.get<CapacityRollup>('/api/capacity/rollup', { from, to }),

  listTrackerConnections: () => api.get<TrackerConnection[]>('/api/tracker/connections'),
  refreshTrackerConnection: (id: string, opts: { force?: boolean } = {}) =>
    api.post<{
      status: string;
      error?: string;
      projectsScanned: number;
      projectsPatched: number;
    }>(`/api/tracker/connections/${id}/refresh`, opts),
  importTrackerItems: (
    id: string,
    externalIds: string[],
    opts: { overwrite?: boolean } = {},
  ) =>
    api.post<{
      created: Array<{ id: string; externalId: string }>;
      updated?: Array<{ id: string; externalId: string }>;
      skipped: string[];
    }>(`/api/tracker/connections/${id}/import`, { externalIds, ...opts }),
  refreshProject: (id: string) =>
    api.post<{ status: string; projectsPatched: number }>(`/api/tracker/projects/${id}/refresh`),

  getPreferences: () => api.get<UserPreferences>('/api/me/preferences'),
  updatePreferences: (hiddenProjectColumns: string[]) =>
    api.put<UserPreferences>('/api/me/preferences', { hiddenProjectColumns }),

  listRisks: () => api.get<RiskListItem[]>('/api/risks'),
  listRisksWithStale: () => api.get<RisksWithStale>('/api/risks', { include: 'stale' }),
  myWeekProjects: () => api.get<MyWeekProject[]>('/api/risks/my-week'),
  getProjectRiskUpdates: (projectId: string) =>
    api.get<ProjectRiskUpdate[]>(`/api/projects/${projectId}/risk-updates`),
  upsertProjectRiskUpdate: (projectId: string, body: ProjectRiskUpdateUpsert) =>
    api.post<ProjectRiskUpdate>(`/api/projects/${projectId}/risk-updates`, body),

  listHarvestProjects: () =>
    api.get<HarvestProjectListItem[]>('/api/tracker/harvest/projects'),
  /** Per-project: every Harvest project pinned to this Torii project, returned as an array. */
  getProjectHarvest: (projectId: string) =>
    api.get<{ harvestProjects: HarvestProjectSnapshot[] }>(`/api/projects/${projectId}/harvest`),
  refreshProjectHarvest: (projectId: string) =>
    api.post<{ harvestProjects: HarvestProjectSnapshot[] }>(`/api/projects/${projectId}/harvest/refresh`, {}),

  getDashboardSummary: () =>
    api.get<DashboardSummary>('/api/dashboard/summary'),

  // Customers
  listCustomers: () => api.get<CustomerListItem[]>('/api/customers'),
  getCustomer: (id: string) => api.get<CustomerDetail>(`/api/customers/${id}`),
  createCustomer: (body: { name: string; harvestClientId?: string }) =>
    api.post<{ id: string; name: string; harvestClientId: string | null }>(`/api/customers`, body),
  updateCustomer: (id: string, body: { name?: string; harvestClientId?: string | null }) =>
    api.patch<{ id: string; name: string; harvestClientId: string | null }>(`/api/customers/${id}`, body),
  customerReconciliation: (id: string) =>
    api.get<CustomerReconciliation>(`/api/customers/${id}/reconciliation`),

  // Harvest client + pin linking (admin only)
  listHarvestClients: () =>
    api.get<HarvestClientListItem[]>('/api/tracker/harvest/clients'),
  linkCustomerToHarvestClient: (customerId: string, harvestClientId: string) =>
    api.post<{ id: string; name: string; harvestClientId: string | null }>(
      `/api/customers/${customerId}/harvest-link`,
      { harvestClientId },
    ),
  unlinkCustomerHarvestClient: (customerId: string) =>
    api.delete<void>(`/api/customers/${customerId}/harvest-link`),
  pinHarvestProject: (harvestProjectId: string, toriiProjectId: string) =>
    api.post<{ ok: true }>(
      `/api/tracker/harvest/projects/${harvestProjectId}/pin`,
      { toriiProjectId },
    ),
  unpinHarvestProject: (harvestProjectId: string) =>
    api.delete<void>(`/api/tracker/harvest/projects/${harvestProjectId}/pin`),

  // Per-person workload (self-reported capacity)
  getPersonWorkload: (id: string) =>
    api.get<WorkloadResponse>(`/api/people/${id}/workload`),
  updatePersonWorkload: (id: string, body: WorkloadUpdate) =>
    api.patch<WorkloadResponse>(`/api/people/${id}/workload`, body),

  // People index overview
  getPeopleOverview: () =>
    api.get<PeopleOverviewRow[]>('/api/people/overview'),

  // Topbar global search
  search: (q: string) =>
    api.get<SearchResults>('/api/search', { q }),

  // Insights — PM-only portfolio overview
  getInsightsOverview: () =>
    api.get<InsightsOverview>('/api/insights/overview'),
};

/** One event from the SSE stream returned by `POST /api/insights/chat`. */
export type InsightsChatEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; name: string; status: 'started' | 'completed'; summary?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * POST to `/api/insights/chat` and consume the SSE stream, invoking `onEvent`
 * for each parsed event. Resolves when the server emits `done` or the response
 * stream closes. Pass an `AbortSignal` to cancel mid-flight (page unmount, new
 * prompt, etc).
 */
export async function streamInsightsChat(opts: {
  messages: ChatMessage[];
  onEvent: (event: InsightsChatEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const response = await fetch('/api/insights/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: opts.messages }),
    signal: opts.signal,
  });

  if (!response.ok) {
    // The 503 / 403 paths return JSON, not SSE.
    let message = `Chat request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore parse failure
    }
    opts.onEvent({ type: 'error', message });
    return;
  }

  const body = response.body;
  if (!body) {
    opts.onEvent({ type: 'error', message: 'No response body' });
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are delimited by a blank line. Each event is one or more
      // `field: value` lines.
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const raw of events) {
        const lines = raw.split('\n');
        const dataLines = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        const payload = dataLines.join('\n');
        try {
          const parsed = JSON.parse(payload) as InsightsChatEvent;
          opts.onEvent(parsed);
          if (parsed.type === 'done' || parsed.type === 'error') return;
        } catch {
          // skip malformed event
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

/** Result shape from `GET /api/search?q=...`. Each list capped server-side. */
export interface SearchResults {
  projects: Array<{ id: string; name: string; phase: Phase; state: ProjectState }>;
  customers: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string; role: Role; isAdmin: boolean }>;
}

/**
 * Per-Harvest-project snapshot row returned by `GET /api/projects/:id/harvest`.
 * Hours-only by design (D9).
 */
export interface HarvestProjectSnapshot {
  /** Harvest's own numeric project ID, stored as text. */
  id: string;
  name: string;
  customerId: string;
  /** Torii project this Harvest project is pinned to, or null when customer-only. */
  projectId: string | null;
  isBillable: boolean;
  harvestProjectUrl: string;
  budgetHours: number | null;
  spentHoursBillable: number;
  spentHoursNonbillable: number;
  breakdown: HarvestBreakdownTask[];
  fetchedAt: string;
}

/** Response from `GET /api/customers/:id` — single customer with resolved relations. */
export interface CustomerDetail {
  id: string;
  name: string;
  harvestClientId: string | null;
  createdAt: string;
  updatedAt: string;
  projects: Project[];
  harvestProjects: Array<{
    id: string;
    name: string;
    customerId: string;
    projectId: string | null;
    isBillable: boolean;
    harvestProjectUrl: string;
    budgetHours: number | null;
    spentHoursBillable: number;
    spentHoursNonbillable: number;
    fetchedAt: string;
    pinnedProject: { id: string; name: string } | null;
  }>;
}

/** Per-(task, person) row in a Harvest snapshot. Hours only — no cost data. */
export interface HarvestBreakdownPerson {
  personId: string;
  personName: string;
  hours: number;
  archived?: boolean;
}

export interface HarvestBreakdownTask {
  taskId: string;
  taskName: string;
  taskBudgetHours: number | null;
  taskSpentHours: number;
  people: HarvestBreakdownPerson[];
}

/** Row returned by `GET /api/tracker/harvest/projects` — one per Harvest project, with link state. */
export interface HarvestProjectListItem {
  harvestProjectId: string;
  name: string;
  linkedToiriProjectId: string | null;
  linkedToiriProjectName: string | null;
}

/** Row returned by `GET /api/tracker/harvest/users` — one per Harvest user, with Person link state. */
export interface HarvestUserListItem {
  harvestUserId: string;
  name: string;
  email: string;
  linkedToiriPersonId: string | null;
  linkedToiriPersonName: string | null;
}

/**
 * One row of the per-person reconciliation endpoint. `actualHours`/`variance`/
 * `variancePct` are null when the Person isn't linked to a Harvest user yet.
 */
export interface PersonReconciliationRow {
  projectId: string;
  projectName: string;
  plannedHours: number;
  actualHours: number | null;
  variance: number | null;
  variancePct: number | null;
  linkedToHarvest: boolean;
}

/** Cached Harvest snapshot for a single project. Hours-only by design (D9). */
export interface HarvestSnapshot {
  projectId: string;
  fetchedAt: string;
  harvestProjectId: string;
  harvestProjectUrl: string;
  budgetHours: number | null;
  spentHoursBillable: number;
  spentHoursNonbillable: number;
  breakdown: HarvestBreakdownTask[];
}
