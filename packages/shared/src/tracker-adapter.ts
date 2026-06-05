import type { Phase, TrackerProvider } from './enums.js';

export interface ExternalProject {
  externalId: string;
  name?: string;
  /**
   * Delivery phase as reported by the tracker. The adapter is responsible for
   * mapping the tracker's column value (e.g., Monday's "[4] Development") to a
   * Torii `Phase` enum value. Adapters MUST omit this when they can't resolve
   * the value rather than guessing.
   */
  phase?: Phase;
  /**
   * Key dates extracted from the tracker. Keys match `KeyDatesSchema`; values are ISO yyyy-mm-dd.
   * The adapter is responsible for normalization. Only keys the adapter actually has a source for
   * are populated — Torii-owned keys (e.g., `hypercare_end`) are not included.
   */
  keyDates?: Partial<Record<
    | 'kickoff'
    | 'project_start'
    | 'uat_start'
    | 'baseline_go_live'
    | 'target_go_live'
    | 'actual_go_live',
    string
  >>;
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
  // Monday-sourced from the "Project Phase" status column.
  phase: 'monday',
  // Monday-sourced key dates.
  'key_dates.kickoff': 'monday',
  'key_dates.project_start': 'monday',
  'key_dates.uat_start': 'monday',
  'key_dates.baseline_go_live': 'monday',
  'key_dates.target_go_live': 'monday',
  'key_dates.actual_go_live': 'monday',
  // No Monday source — Torii-derived.
  'key_dates.hypercare_end': 'torii',
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
  // Monday-sourced (from "Fintech Parent", falling back to "Fintech").
  'details.fintech_parent': 'monday',
  // No Monday source — PM-managed.
  'details.primary_contact': 'torii',
};
