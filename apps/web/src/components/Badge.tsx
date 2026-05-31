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

/**
 * "On budget" / "Over budget −N%" chip. Renders only when a snapshot exists
 * (snapshot prop is non-null); otherwise nothing — an "On budget" claim with
 * no data would be misleading. Use alongside the State badge in the header.
 */
export function OnBudgetChip({
  budgetHours,
  spentBillable,
  spentNonbillable,
}: {
  budgetHours: number | null;
  spentBillable: number;
  spentNonbillable: number;
}) {
  if (budgetHours === null || budgetHours <= 0) return null;
  const spent = spentBillable + spentNonbillable;
  const pct = Math.round(((spent - budgetHours) / budgetHours) * 100);
  const isOver = spent > budgetHours;
  if (isOver) {
    // Use a Unicode minus to mirror the prototype's "Over budget −36%" formatting.
    // `pct` here is positive (overage); the minus indicates the budget remaining is negative.
    return (
      <span className="badge bg-red-50 text-red-700">Over budget −{pct}%</span>
    );
  }
  return <span className="badge bg-emerald-50 text-emerald-700">On budget</span>;
}
