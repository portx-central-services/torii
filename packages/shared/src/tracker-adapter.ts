import type { TrackerProvider } from './enums.js';

export interface ExternalProject {
  externalId: string;
  name?: string;
  /** ISO yyyy-mm-dd; the adapter is responsible for normalization. */
  targetGoLive?: string;
  /** Free-form project detail fields keyed by `ProjectDetailKey`. */
  details?: Record<string, string>;
  /** Adapter-specific raw payload, retained for debugging. */
  raw?: unknown;
}

export interface TrackerMetadata {
  provider: TrackerProvider;
  workspace: string;
  /** Surfaced in admin UI; describes what the adapter can do. */
  capabilities: {
    listProjects: boolean;
    getProject: boolean;
  };
}

export interface TrackerAccessProbe {
  name: string;
  ok: boolean;
  detail?: string;
  error?: string;
}

export interface TrackerAccessCheck {
  ok: boolean;
  identity?: {
    id?: string;
    name?: string;
    email?: string;
    account?: { id?: string; name?: string; slug?: string };
  };
  probes: TrackerAccessProbe[];
}

export interface TrackerAdapter {
  listProjects(): Promise<ExternalProject[]>;
  getProject(externalId: string): Promise<ExternalProject | null>;
  getMetadata(): Promise<TrackerMetadata>;
  verifyAccess(): Promise<TrackerAccessCheck>;
}

/** Per-field ownership. The string keys are field names, possibly dotted. */
export type FieldOwner = 'torii' | 'monday';

/** Default field-ownership rules per design D6. */
export const DEFAULT_FIELD_MAPPING: Record<string, FieldOwner> = {
  name: 'monday',
  'key_dates.target_go_live': 'monday',
  phase: 'torii',
  state: 'torii',
  // Monday-sourced project details.
  'details.project_manager': 'monday',
  'details.solution_architect': 'monday',
  'details.solution_consultant': 'monday',
  'details.core_solution': 'monday',
  'details.core_vendor': 'monday',
  'details.status_report_url': 'monday',
  'details.jira_project_url': 'monday',
  'details.customer_type': 'monday',
  'details.finance_use_case': 'monday',
  'details.use_case_group': 'monday',
  'details.customer_status': 'monday',
  // No Monday source — PM-managed.
  'details.primary_contact': 'torii',
};
