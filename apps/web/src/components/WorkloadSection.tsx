import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  endpoints,
  type Project,
  type WorkloadResponse,
  type WorkloadRow,
  type WorkloadUpdate,
} from '../api/endpoints.js';

interface WorkloadSectionProps {
  personId: string;
  editable: boolean;
}

export function WorkloadSection({ personId, editable }: WorkloadSectionProps) {
  const queryClient = useQueryClient();
  const workloadQ = useQuery({
    queryKey: ['workload', personId],
    queryFn: () => endpoints.getPersonWorkload(personId),
    staleTime: 0,
  });

  const updateMutation = useMutation({
    mutationFn: (body: WorkloadUpdate) => endpoints.updatePersonWorkload(personId, body),
    onSuccess: async (fresh) => {
      queryClient.setQueryData(['workload', personId], fresh);
      await queryClient.invalidateQueries({ queryKey: ['person-reconciliation', personId] });
      await queryClient.invalidateQueries({ queryKey: ['capacity-rollup'] });
    },
  });

  if (workloadQ.isLoading) {
    return (
      <section className="section-card workload-section">
        <h3 style={{ marginTop: 0 }}>Workload</h3>
        <div className="empty">Loading workload…</div>
      </section>
    );
  }
  if (workloadQ.isError) {
    return (
      <section className="section-card workload-section">
        <h3 style={{ marginTop: 0 }}>Workload</h3>
        <div className="text-red-700">
          Unable to load workload: {(workloadQ.error as Error).message}
        </div>
      </section>
    );
  }

  const data = workloadQ.data as WorkloadResponse;
  const reported = data.projects.reduce((sum, p) => sum + p.weeklyPct, 0);
  const advisoryTotal = reported + data.availabilityPct;
  const overCommittedBy = advisoryTotal - data.defaultCapacityPct;
  const unaccounted = Math.max(0, data.defaultCapacityPct - advisoryTotal);

  return (
    <section className="section-card workload-section">
      <h3 style={{ marginTop: 0 }}>Workload</h3>

      <div className="workload-availability-row">
        <span className="workload-availability-label">Availability for more work</span>
        {editable ? (
          <PctEditor
            value={data.availabilityPct}
            disabled={updateMutation.isPending}
            onCommit={(v) => updateMutation.mutate({ availabilityPct: v })}
          />
        ) : (
          <span className="workload-availability-value">{data.availabilityPct}%</span>
        )}
      </div>

      <div className="workload-totals-row">
        <div className="workload-total-tile">
          <div className="workload-total-tile-label">Last 7 days</div>
          <div className="workload-total-tile-value">
            {data.totals.last7DaysHours === null
              ? <span className="dashboard-em">—</span>
              : `${fmtHours(data.totals.last7DaysHours)}`}
          </div>
          {data.totals.last7DaysByDay ? (
            <SevenDayBarChart days={data.totals.last7DaysByDay} />
          ) : (
            <div className="workload-total-tile-sub">Hours billed in Harvest</div>
          )}
        </div>
        <div className="workload-total-tile">
          <div className="workload-total-tile-label">Last 30 days</div>
          <div className="workload-total-tile-value">
            {data.totals.last30DaysHours === null
              ? <span className="dashboard-em">—</span>
              : `${fmtHours(data.totals.last30DaysHours)}`}
          </div>
          <div className="workload-total-tile-sub">
            {data.totals.last30DaysHours === null
              ? 'Hours billed in Harvest'
              : `Avg ${fmtHours((data.totals.last30DaysHours * 7) / 30)}/week`}
          </div>
          {data.totals.last30DaysHours !== null && data.totals.last30DaysHours > 0 && (
            <ThirtyDayProjectBreakdown
              projects={data.projects}
              total={data.totals.last30DaysHours}
            />
          )}
        </div>
      </div>

      {data.projects.length === 0 ? (
        <div className="empty workload-empty">
          {editable ? 'No projects reported. Add one below to start tracking.' : 'Nothing to show yet.'}
        </div>
      ) : (
        <table className="workload-table">
          <thead>
            <tr>
              <th>Project</th>
              <th style={{ textAlign: 'right' }}>Current</th>
              <th style={{ textAlign: 'right' }}>Planned</th>
              <th style={{ textAlign: 'right' }}>7d</th>
              <th style={{ textAlign: 'right' }}>30d</th>
              <th style={{ textAlign: 'right' }}>Lifetime</th>
              <th>Variance</th>
              {editable && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {data.projects.map((row) => (
              <WorkloadRowView
                key={row.projectId}
                row={row}
                editable={editable}
                disabled={updateMutation.isPending}
                onCommit={(weeklyPct) =>
                  updateMutation.mutate({
                    projects: [{ projectId: row.projectId, weeklyPct }],
                  })
                }
              />
            ))}
          </tbody>
        </table>
      )}

      {editable && (
        <AddProjectControl
          existingProjectIds={new Set(data.projects.map((p) => p.projectId))}
          disabled={updateMutation.isPending}
          onAdd={(projectId) =>
            updateMutation.mutate({
              projects: [{ projectId, weeklyPct: 5 }],
            })
          }
        />
      )}

      <div
        className={`workload-advisory${overCommittedBy > 0 ? ' workload-advisory-warn' : ''}`}
      >
        Σ reported: <strong>{reported}%</strong> · availability:{' '}
        <strong>{data.availabilityPct}%</strong> ·{' '}
        {overCommittedBy > 0 ? (
          <>
            over-committed by <strong>{overCommittedBy}%</strong>
          </>
        ) : (
          <>
            unaccounted: <strong>{unaccounted}%</strong>
          </>
        )}
        {data.lastReportedAt && (
          <span className="workload-advisory-stale">
            {' '}· last reported {relativeTime(new Date(data.lastReportedAt))}
          </span>
        )}
      </div>
    </section>
  );
}

function WorkloadRowView({
  row,
  editable,
  disabled,
  onCommit,
}: {
  row: WorkloadRow;
  editable: boolean;
  disabled: boolean;
  onCommit: (weeklyPct: number) => void;
}) {
  const bucketClass = `variance-chip variance-chip-${row.varianceBucket}`;
  return (
    <tr>
      <td>
        <Link to={`/projects/${row.projectId}`} className="text-torii hover:underline">
          {row.projectName}
        </Link>
        <span className="workload-phase-badge">{row.projectPhase}</span>
      </td>
      <td style={{ textAlign: 'right' }}>
        {editable ? (
          <PctEditor value={row.weeklyPct} disabled={disabled} onCommit={onCommit} />
        ) : (
          <span>{row.weeklyPct}%</span>
        )}
      </td>
      <td style={{ textAlign: 'right' }}>
        {row.allocatedPct > 0 ? (
          <span className="workload-allocated">Planned: {row.allocatedPct}%</span>
        ) : (
          <span className="dashboard-em">—</span>
        )}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {row.last7DaysHours === null ? (
          <span className="dashboard-em">—</span>
        ) : (
          fmtHours(row.last7DaysHours)
        )}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {row.last30DaysHours === null ? (
          <span className="dashboard-em">—</span>
        ) : (
          fmtHours(row.last30DaysHours)
        )}
      </td>
      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {row.lifetimeHours === null ? (
          <span className="dashboard-em">—</span>
        ) : (
          fmtHours(row.lifetimeHours)
        )}
      </td>
      <td>
        <span className={bucketClass}>{row.varianceBucket === 'neutral' ? 'no data' : row.varianceBucket}</span>
      </td>
      {editable && (
        <td style={{ textAlign: 'right' }}>
          <button
            type="button"
            className="btn-ghost"
            disabled={disabled}
            onClick={() => onCommit(0)}
            aria-label={`Remove ${row.projectName} from workload`}
          >
            Remove
          </button>
        </td>
      )}
    </tr>
  );
}

function PctEditor({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (next: number) => void;
}) {
  const [local, setLocal] = useState<string>(String(value));
  const lastCommitted = useRef(value);
  useEffect(() => {
    setLocal(String(value));
    lastCommitted.current = value;
  }, [value]);

  function commit(raw: string) {
    const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    if (n === lastCommitted.current) return;
    lastCommitted.current = n;
    setLocal(String(n));
    onCommit(n);
  }

  return (
    <span className="pct-input-wrap">
      <input
        type="number"
        className="input pct-input"
        min={0}
        max={100}
        step={5}
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="pct-input-suffix">%</span>
    </span>
  );
}

function AddProjectControl({
  existingProjectIds,
  disabled,
  onAdd,
}: {
  existingProjectIds: Set<string>;
  disabled: boolean;
  onAdd: (projectId: string) => void;
}) {
  const projectsQ = useQuery({
    queryKey: ['projects', 'workload-picker'],
    queryFn: () => endpoints.listProjects({}),
  });

  const candidates: Project[] = (projectsQ.data ?? [])
    .filter((p) => p.state !== 'Done' && !existingProjectIds.has(p.id))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  if (candidates.length === 0) return null;

  return (
    <div className="workload-add-row">
      <span className="workload-add-label">Add project:</span>
      <select
        className="input"
        defaultValue=""
        disabled={disabled}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          onAdd(id);
          e.target.value = '';
        }}
      >
        <option value="">Pick a project…</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function fmtHours(h: number): string {
  if (h === 0) return '0h';
  return `${h.toLocaleString('en-US', { maximumFractionDigits: 1 })}h`;
}

/**
 * Per-project breakdown of the trailing 30 days, sorted by hours descending.
 * Projects with zero hours are skipped. When the per-project sum doesn't
 * match the total (because customer-only Harvest projects contribute to the
 * total but not to the per-project rows), surface the gap as "Other".
 */
function ThirtyDayProjectBreakdown({
  projects,
  total,
}: {
  projects: WorkloadRow[];
  total: number;
}) {
  const ranked = projects
    .filter((p) => (p.last30DaysHours ?? 0) > 0)
    .slice()
    .sort((a, b) => (b.last30DaysHours ?? 0) - (a.last30DaysHours ?? 0));
  if (ranked.length === 0) return null;
  const sumPerProject = ranked.reduce((sum, p) => sum + (p.last30DaysHours ?? 0), 0);
  const gap = Math.max(0, Number((total - sumPerProject).toFixed(2)));
  return (
    <ul className="workload-7d-projects">
      {ranked.map((p) => (
        <li key={p.projectId} className="workload-7d-project-row">
          <Link
            to={`/projects/${p.projectId}`}
            className="workload-7d-project-name text-torii hover:underline"
          >
            {p.projectName}
          </Link>
          <span className="workload-7d-project-hours">{fmtHours(p.last30DaysHours ?? 0)}</span>
        </li>
      ))}
      {gap > 0 && (
        <li
          className="workload-7d-project-row workload-7d-project-other"
          title="Hours on Harvest projects that aren't pinned to a Torii project (typically customer-level support time)"
        >
          <span className="workload-7d-project-name">Other</span>
          <span className="workload-7d-project-hours">{fmtHours(gap)}</span>
        </li>
      )}
    </ul>
  );
}

/**
 * Inline 7-bar chart of hours-per-day. Oldest day on the left, today on the
 * right. Bar height scales to the larger of (max day in window, 8h target)
 * so an unusually heavy day towers honestly without making lighter days
 * disappear when the whole week is quiet.
 */
function SevenDayBarChart({ days }: { days: Array<{ date: string; hours: number }> }) {
  const maxObserved = Math.max(0, ...days.map((d) => d.hours));
  const scale = Math.max(maxObserved, 8);
  const dayInitials = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return (
    <div className="workload-7d-chart" aria-label="Hours per day for the last 7 days">
      {days.map((d) => {
        const pct = scale > 0 ? (d.hours / scale) * 100 : 0;
        const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
        const initial = dayInitials[dow] ?? '';
        return (
          <div
            key={d.date}
            className="workload-7d-bar"
            title={`${d.date}: ${d.hours === 0 ? 'no hours' : fmtHours(d.hours)}`}
          >
            <div className="workload-7d-bar-track">
              <div
                className="workload-7d-bar-fill"
                style={{ height: `${pct}%` }}
                aria-hidden
              />
            </div>
            <div className="workload-7d-bar-label">{initial}</div>
          </div>
        );
      })}
    </div>
  );
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
