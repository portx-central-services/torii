import type { TrackerProvider } from './enums.js';

export interface ExternalProject {
  externalId: string;
  name?: string;
  /** ISO yyyy-mm-dd; the adapter is responsible for normalization. */
  targetGoLive?: string;
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

export interface TrackerAdapter {
  listProjects(): Promise<ExternalProject[]>;
  getProject(externalId: string): Promise<ExternalProject | null>;
  getMetadata(): Promise<TrackerMetadata>;
}

/** Per-field ownership. The string keys are field names, possibly dotted. */
export type FieldOwner = 'torii' | 'monday';

/** Default field-ownership rules per design D6. */
export const DEFAULT_FIELD_MAPPING: Record<string, FieldOwner> = {
  name: 'monday',
  'key_dates.target_go_live': 'monday',
  phase: 'torii',
  state: 'torii',
};
