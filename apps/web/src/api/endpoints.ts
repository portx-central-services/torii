import type {
  Phase,
  ProjectState,
  Role,
} from '@torii/shared';
import { api } from './client.js';

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
  providers: Array<'google' | 'okta'>;
}

export const PROJECT_DETAIL_FIELDS = [
  { key: 'project_manager', label: 'Project Manager' },
  { key: 'solution_architect', label: 'Solution Architect' },
  { key: 'solution_consultant', label: 'Solution Consultant' },
  { key: 'core_solution', label: 'Core Solution' },
  { key: 'core_vendor', label: 'Core Vendor' },
  { key: 'primary_contact', label: 'Primary Contact' },
  { key: 'status_report_url', label: 'Status Report', isLink: true },
  { key: 'jira_project_url', label: 'Jira Project', isLink: true },
  { key: 'customer_type', label: 'Customer Type' },
  { key: 'finance_use_case', label: 'Finance - Use Case' },
  { key: 'use_case_group', label: 'Use Case - Group' },
  { key: 'customer_status', label: 'Customer Status' },
] as const;

export type ProjectDetailKey = (typeof PROJECT_DETAIL_FIELDS)[number]['key'];

export type ProjectDetails = Partial<Record<ProjectDetailKey, string>>;

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

export interface Project {
  id: string;
  name: string;
  phase: Phase;
  state: ProjectState;
  keyDates: {
    kickoff?: string;
    target_go_live?: string;
    actual_go_live?: string;
    hypercare_end?: string;
  };
  details: ProjectDetails;
  ownerId: string | null;
  trackerRef: { provider: string; externalId: string } | null;
  fieldMapping: Record<string, 'torii' | 'monday'>;
  createdAt: string;
  updatedAt: string;
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
  signout: () => api.post<{ ok: true }>('/api/auth/signout'),

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
  personAllocations: (id: string, from: string, to: string) =>
    api.get<PersonAllocation[]>(`/api/people/${id}/allocations`, { from, to }),

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
};
