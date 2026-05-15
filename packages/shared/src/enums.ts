import { z } from 'zod';

export const PHASES = ['Discovery', 'Build', 'UAT', 'Launch', 'Hypercare'] as const;
export const PROJECT_STATES = ['OnTrack', 'AtRisk', 'Blocked', 'Done'] as const;
export const ROLES = ['PM', 'Viewer'] as const;
export const TRACKER_PROVIDERS = ['monday'] as const;

export const PhaseSchema = z.enum(PHASES);
export const ProjectStateSchema = z.enum(PROJECT_STATES);
export const RoleSchema = z.enum(ROLES);
export const TrackerProviderSchema = z.enum(TRACKER_PROVIDERS);

export type Phase = z.infer<typeof PhaseSchema>;
export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type TrackerProvider = z.infer<typeof TrackerProviderSchema>;
