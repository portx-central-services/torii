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
              <th style={{ textAlign: 'right' }}>Lifetime hours</th>
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
      <td style={{ textAlign: 'right' }}>
        {row.lifetimeHours === null ? (
          <span className="dashboard-em">—</span>
        ) : (
          `${row.lifetimeHours.toLocaleString('en-US', { maximumFractionDigits: 1 })}h`
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
