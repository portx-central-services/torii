import { z } from 'zod';

/**
 * Delivery phases as understood by the PortX PMO. Ordered from earliest to latest.
 *
 *  - `Backlog` — committed, work has not started
 *  - `Initiation` — formal kickoff / discovery
 *  - `Design` — solution design
 *  - `Development` — active build
 *  - `UAT` — user acceptance testing
 *  - `GoLiveReadiness` — cutover readiness / launch
 *  - `Production` — live; hypercare and steady state
 *
 * The enum value is a TypeScript- and Postgres-safe identifier. Use {@link phaseLabel}
 * for the human-readable display string (e.g., "Go-Live Readiness").
 */
export const PHASES = [
  'Backlog',
  'Initiation',
  'Design',
  'Development',
  'UAT',
  'GoLiveReadiness',
  'Production',
] as const;
export const PROJECT_STATES = ['OnTrack', 'AtRisk', 'Blocked', 'Done'] as const;
export const ROLES = ['PM', 'Viewer'] as const;
export const TRACKER_PROVIDERS = ['monday'] as const;

export const RAG_LEVELS = ['Red', 'Amber', 'Green'] as const;
export const RISK_TYPES = [
  'Technical',
  'Relationship',
  'Schedule',
  'ExternalDependency',
  'Gap',
  'Resourcing',
] as const;
export const RISK_STATES = ['Blocked', 'Inform'] as const;

export const PROJECT_TYPES = ['direct', 'fintech'] as const;

export const PhaseSchema = z.enum(PHASES);
export const ProjectStateSchema = z.enum(PROJECT_STATES);
export const RoleSchema = z.enum(ROLES);
export const TrackerProviderSchema = z.enum(TRACKER_PROVIDERS);
export const RagLevelSchema = z.enum(RAG_LEVELS);
export const RiskTypeSchema = z.enum(RISK_TYPES);
export const RiskStateSchema = z.enum(RISK_STATES);
export const ProjectTypeSchema = z.enum(PROJECT_TYPES);

export type Phase = z.infer<typeof PhaseSchema>;

/** Display labels for phase enum values. The only non-identity mapping is `GoLiveReadiness` → "Go-Live Readiness". */
export const PHASE_LABELS: Record<Phase, string> = {
  Backlog: 'Backlog',
  Initiation: 'Initiation',
  Design: 'Design',
  Development: 'Development',
  UAT: 'UAT',
  GoLiveReadiness: 'Go-Live Readiness',
  Production: 'Production',
};

export function phaseLabel(phase: Phase): string {
  return PHASE_LABELS[phase];
}

export type ProjectState = z.infer<typeof ProjectStateSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type TrackerProvider = z.infer<typeof TrackerProviderSchema>;
export type RagLevel = z.infer<typeof RagLevelSchema>;
export type RiskType = z.infer<typeof RiskTypeSchema>;
export type RiskState = z.infer<typeof RiskStateSchema>;
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

/**
 * Derive the project type from a `details`-shaped record.
 *
 * "fintech" iff `fintech_parent` is a non-empty (after trimming) string. Otherwise
 * "direct". `fintech_parent` is not (yet) one of the strict `ProjectDetails` keys —
 * it is a tolerated extra key that today is never populated (so every project
 * derives as `'direct'`). A future change that extracts the "Fintech Parent" Monday
 * column or accepts the field via PATCH lights this up without further work here.
 */
export function deriveProjectType(
  details: Record<string, unknown> | null | undefined,
): ProjectType {
  const v = details?.['fintech_parent'];
  return typeof v === 'string' && v.trim().length > 0 ? 'fintech' : 'direct';
}
