import { phaseLabel, type Phase, type ProjectState } from '@torii/shared';

const phaseStyle: Record<Phase, string> = {
  Backlog: 'bg-gray-100 text-gray-700',
  Initiation: 'bg-violet-50 text-violet-700',
  Design: 'bg-fuchsia-50 text-fuchsia-700',
  Development: 'bg-cyan-50 text-cyan-800',
  UAT: 'bg-emerald-50 text-emerald-700',
  GoLiveReadiness: 'bg-amber-50 text-amber-800',
  Production: 'bg-teal-50 text-teal-700',
};

const stateStyle: Record<ProjectState, string> = {
  OnTrack: 'bg-emerald-50 text-emerald-700',
  AtRisk: 'bg-amber-50 text-amber-800',
  Blocked: 'bg-red-50 text-red-700',
  Done: 'bg-gray-100 text-gray-700',
};

export function PhaseBadge({ phase }: { phase: Phase }) {
  return <span className={`badge ${phaseStyle[phase]}`}>{phaseLabel(phase)}</span>;
}

export function StateBadge({ state }: { state: ProjectState }) {
  return <span className={`badge ${stateStyle[state]}`}>{state}</span>;
}
