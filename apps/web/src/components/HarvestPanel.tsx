import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endpoints, type HarvestSnapshot, type Project, type ProjectDetailKey } from '../api/endpoints.js';
import { ApiError } from '../api/client.js';

interface HarvestPanelProps {
  project: Project;
  isPm: boolean;
}

/**
 * Project-detail Harvest panel — hours-only by design (D9). Renders four metric
 * tiles, the per-(task, person) breakdown accordion, and a "View in Harvest →"
 * link to the source. No cost or invoicing data.
 */
export function HarvestPanel({ project, isPm }: HarvestPanelProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const snapQ = useQuery({
    queryKey: ['harvest-snapshot', project.id],
    queryFn: () => endpoints.getHarvestSnapshot(project.id),
    retry: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => endpoints.refreshHarvestSnapshot(project.id),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['harvest-snapshot', project.id] });
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? e.status === 429
            ? 'Harvest is rate-limited — retry in 15 seconds.'
            : e.message
          : 'Refresh failed',
      ),
  });

  // "Not yet refreshed" state (snapshot endpoint returns 404)
  const isNotYetRefreshed = snapQ.isError && snapQ.error instanceof ApiError && snapQ.error.status === 404;

  if (snapQ.isLoading) {
    return (
      <section className="section-card harvest-panel">
        <div className="empty">Loading Harvest snapshot…</div>
      </section>
    );
  }

  if (isNotYetRefreshed) {
    return (
      <section className="section-card harvest-panel">
        <div className="harvest-panel-header">
          <h3>Harvest</h3>
          {isPm && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              {refreshMutation.isPending ? 'Refreshing…' : 'Refresh from Harvest'}
            </button>
          )}
        </div>
        <div className="empty">
          Not yet refreshed.{' '}
          {isPm ? 'Click "Refresh from Harvest" to fetch the latest hours.' : 'Ask a PM to refresh.'}
        </div>
        {error && <div className="text-red-700" style={{ marginTop: 8 }}>{error}</div>}
      </section>
    );
  }

  if (snapQ.isError) {
    return (
      <section className="section-card harvest-panel">
        <div className="text-red-700">
          Unable to load Harvest snapshot: {(snapQ.error as Error).message}
        </div>
      </section>
    );
  }

  const snap = snapQ.data!;
  const totalSpent = snap.spentHoursBillable + snap.spentHoursNonbillable;
  const remaining = snap.budgetHours === null ? null : snap.budgetHours - totalSpent;
  const pctOver = snap.budgetHours && snap.budgetHours > 0
    ? Math.round(((totalSpent - snap.budgetHours) / snap.budgetHours) * 100)
    : null;
  const isOver = pctOver !== null && pctOver > 0;
  const fillPct = snap.budgetHours && snap.budgetHours > 0
    ? Math.min(100, (totalSpent / snap.budgetHours) * 100)
    : 0;

  return (
    <section className="section-card harvest-panel">
      <div className="harvest-panel-header">
        <h3>Harvest</h3>
        <div className="harvest-panel-header-actions">
          <a className="link" href={snap.harvestProjectUrl} target="_blank" rel="noopener noreferrer">
            View in Harvest →
          </a>
          <span className="harvest-panel-refresh-time">
            Updated {relativeTime(new Date(snap.fetchedAt))}
          </span>
          {isPm && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              {refreshMutation.isPending ? 'Refreshing…' : 'Refresh from Harvest'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-red-700" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="harvest-tiles">
        <Tile label="Total hours">
          <div className="harvest-tile-value">{fmtHours(totalSpent)}</div>
          <div className="harvest-tile-sub">
            Billable {fmtHours(snap.spentHoursBillable)} · Non-billable {fmtHours(snap.spentHoursNonbillable)}
          </div>
        </Tile>
        <Tile label="Budget hours">
          <div className="harvest-tile-value">
            {snap.budgetHours === null ? '—' : fmtHours(snap.budgetHours)}
          </div>
          <div className="harvest-tile-sub">
            {snap.budgetHours === null ? 'No budget set in Harvest' : 'as configured in Harvest'}
          </div>
        </Tile>
        <Tile label="Budget remaining">
          <div className={`harvest-tile-value ${isOver ? 'text-red-700' : ''}`}>
            {remaining === null ? '—' : fmtHours(remaining)}
            {pctOver !== null && (
              <span className="harvest-tile-pct"> ({pctOver > 0 ? '+' : ''}{pctOver}%)</span>
            )}
          </div>
          {snap.budgetHours !== null && (
            <div className="harvest-budget-bar">
              <div
                className={`harvest-budget-bar-fill ${isOver ? 'harvest-budget-bar-fill-over' : ''}`}
                style={{ width: `${fillPct}%` }}
              />
              {isOver && <div className="harvest-budget-bar-overflow" />}
            </div>
          )}
        </Tile>
      </div>

      <HarvestBreakdown snapshot={snap} project={project} />
    </section>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="harvest-tile">
      <div className="harvest-tile-label">{label}</div>
      {children}
    </div>
  );
}

function HarvestBreakdown({ snapshot, project }: { snapshot: HarvestSnapshot; project: Project }) {
  const [open, setOpen] = useState(false);

  if (snapshot.breakdown.length === 0) {
    return null;
  }

  return (
    <details className="harvest-breakdown" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>By task and person ({snapshot.breakdown.length} task{snapshot.breakdown.length === 1 ? '' : 's'})</summary>
      <div className="harvest-breakdown-body">
        {snapshot.breakdown.map((task) => (
          <div key={task.taskId} className="harvest-task-group">
            <div className="harvest-task-header">
              <span className="harvest-task-name">{task.taskName}</span>
              <span className="harvest-task-hours">
                {fmtHours(task.taskSpentHours)}
                {task.taskBudgetHours !== null && (
                  <span className="harvest-task-budget"> / {fmtHours(task.taskBudgetHours)}</span>
                )}
              </span>
            </div>
            <div className="harvest-person-rows">
              {task.people.map((person) => {
                const role = matchPersonRole(person.personName, project);
                return (
                  <div key={person.personId} className="harvest-person-row">
                    <span className="harvest-person-name">
                      {role && <span className="harvest-role-badge">{role}</span>}
                      {person.personName}
                      {person.archived && <span className="harvest-archived"> (archived)</span>}
                    </span>
                    <span className="harvest-person-hours">{fmtHours(person.hours)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * Match a Harvest person name against the project's PM/SA/SC details. Returns the
 * role badge label when a name matches (case-insensitive); otherwise null.
 */
function matchPersonRole(personName: string, project: Project): 'PM' | 'SA' | 'SC' | null {
  const target = personName.trim().toLowerCase();
  if (!target) return null;
  const pairs: Array<{ key: ProjectDetailKey; label: 'PM' | 'SA' | 'SC' }> = [
    { key: 'project_manager', label: 'PM' },
    { key: 'solution_architect', label: 'SA' },
    { key: 'solution_consultant', label: 'SC' },
  ];
  for (const { key, label } of pairs) {
    const v = project.details?.[key]?.trim().toLowerCase();
    if (v && v === target) return label;
  }
  return null;
}

function fmtHours(h: number): string {
  return `${h.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: h % 1 === 0 ? 0 : 2 })}h`;
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}
