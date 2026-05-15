import type { Phase, ProjectState } from '@torii/shared';

const phaseStyle: Record<Phase, string> = {
  Discovery: 'bg-blue-50 text-blue-700',
  Build: 'bg-violet-50 text-violet-700',
  UAT: 'bg-amber-50 text-amber-800',
  Launch: 'bg-orange-50 text-orange-700',
  Hypercare: 'bg-emerald-50 text-emerald-700',
};

const stateStyle: Record<ProjectState, string> = {
  OnTrack: 'bg-emerald-50 text-emerald-700',
  AtRisk: 'bg-amber-50 text-amber-800',
  Blocked: 'bg-red-50 text-red-700',
  Done: 'bg-gray-100 text-gray-700',
};

export function PhaseBadge({ phase }: { phase: Phase }) {
  return <span className={`badge ${phaseStyle[phase]}`}>{phase}</span>;
}

export function StateBadge({ state }: { state: ProjectState }) {
  return <span className={`badge ${stateStyle[state]}`}>{state}</span>;
}
