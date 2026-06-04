import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  endpoints,
  type MyWeekProject,
  type ProjectRiskUpdateUpsert,
  type RagLevel,
  type RiskState,
  type RiskType,
} from '../api/endpoints.js';
import { useIsPM } from '../auth/AuthProvider.js';
import { ApiError } from '../api/client.js';

interface RowState {
  ragLevel: RagLevel;
  state: RiskState;
  riskType: RiskType;
  latestUpdate: string;
  nextSteps: string;
  saving: boolean;
  error: string | null;
  saved: boolean;
}

function defaultRow(): RowState {
  return {
    ragLevel: 'Green',
    state: 'Inform',
    riskType: 'Technical',
    latestUpdate: '',
    nextSteps: '',
    saving: false,
    error: null,
    saved: false,
  };
}

/**
 * PM-only side panel for filing every project's current-week ProjectRiskUpdate
 * in one pass. Visible only when `open` is true; returns null otherwise.
 */
export function WeeklyUpdatePanel({
  open,
  onClose,
  focusProjectId,
}: {
  open: boolean;
  onClose: () => void;
  focusProjectId?: string | null;
}) {
  const isPM = useIsPM();
  const queryClient = useQueryClient();

  const myWeek = useQuery({
    queryKey: ['my-week-projects'],
    queryFn: () => endpoints.myWeekProjects(),
    enabled: open && isPM,
    staleTime: 0,
  });

  // Per-project local state, keyed by projectId.
  const [rows, setRows] = useState<Record<string, RowState>>({});
  useEffect(() => {
    if (!myWeek.data) return;
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const p of myWeek.data) {
        next[p.projectId] = prev[p.projectId] ?? defaultRow();
      }
      return next;
    });
  }, [myWeek.data]);

  // Scroll the focused project into view once the panel renders.
  const focusedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open && focusProjectId && focusedRef.current) {
      focusedRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [open, focusProjectId, myWeek.data]);

  function patchRow(projectId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [projectId]: { ...prev[projectId]!, ...patch } }));
  }

  async function saveOne(p: MyWeekProject) {
    const row = rows[p.projectId];
    if (!row) return;
    patchRow(p.projectId, { saving: true, error: null });
    const body: ProjectRiskUpdateUpsert = {
      ragLevel: row.ragLevel,
      // Backend requires ≥1 risk type. We send the single dropdown value.
      riskTypes: [row.riskType],
      state: row.state,
      description: '',
      goToGreenPlan: '',
      latestUpdate: row.latestUpdate,
      nextSteps: row.nextSteps,
      actionRequested: '',
    };
    try {
      await endpoints.upsertProjectRiskUpdate(p.projectId, body);
      patchRow(p.projectId, { saving: false, saved: true });
    } catch (err) {
      patchRow(p.projectId, {
        saving: false,
        error: err instanceof ApiError ? err.message : (err as Error).message,
      });
    }
  }

  const saveAllMutation = useMutation({
    mutationFn: async () => {
      const projects = myWeek.data ?? [];
      // Sequential saves so per-row errors stay visible against their rows.
      for (const p of projects) {
        if (rows[p.projectId]?.saved) continue;
        await saveOne(p);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['risks', 'with-stale'] });
      await queryClient.invalidateQueries({ queryKey: ['my-week-projects'] });
    },
  });

  if (!open || !isPM) return null;

  const projects = myWeek.data ?? [];
  const remaining = projects.filter((p) => !rows[p.projectId]?.saved);

  return (
    <>
      <div className="weekly-panel-backdrop" onClick={onClose} />
      <aside className="weekly-panel" role="dialog" aria-label="Update my week">
        <header className="weekly-panel-head">
          <h2 className="weekly-panel-title">Update my week</h2>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            aria-label="Close panel"
          >
            ✕
          </button>
        </header>

        <div className="weekly-panel-body">
          {myWeek.isLoading && <div className="empty">Loading…</div>}
          {myWeek.isError && (
            <div className="text-red-700">
              Unable to load your projects: {(myWeek.error as Error).message}
            </div>
          )}
          {myWeek.isSuccess && projects.length === 0 && (
            <div className="weekly-panel-caught-up">You're caught up for this week.</div>
          )}
          {myWeek.isSuccess && remaining.length === 0 && projects.length > 0 && (
            <div className="weekly-panel-caught-up">All updates saved. You can close the panel.</div>
          )}
          {projects.map((p) => {
            const row = rows[p.projectId] ?? defaultRow();
            if (row.saved) return null;
            const focused = focusProjectId === p.projectId;
            return (
              <div
                key={p.projectId}
                ref={focused ? focusedRef : undefined}
                className={`weekly-panel-row${focused ? ' weekly-panel-row-focused' : ''}`}
              >
                <div className="weekly-panel-row-head">
                  <Link to={`/projects/${p.projectId}`} className="text-torii hover:underline">
                    {p.projectName}
                  </Link>
                  <span className="workload-phase-badge">{p.projectPhase}</span>
                  {p.customerId && p.customerName && (
                    <Link to={`/customers/${p.customerId}`} className="weekly-panel-customer">
                      {p.customerName}
                    </Link>
                  )}
                </div>
                <div className="weekly-panel-row-grid">
                  <label>
                    <span>RAG</span>
                    <select
                      className="input"
                      value={row.ragLevel}
                      disabled={row.saving}
                      onChange={(e) =>
                        patchRow(p.projectId, { ragLevel: e.target.value as RagLevel })
                      }
                    >
                      <option value="Green">Green</option>
                      <option value="Amber">Amber</option>
                      <option value="Red">Red</option>
                    </select>
                  </label>
                  <label>
                    <span>State</span>
                    <select
                      className="input"
                      value={row.state}
                      disabled={row.saving || row.ragLevel === 'Green'}
                      onChange={(e) =>
                        patchRow(p.projectId, { state: e.target.value as RiskState })
                      }
                    >
                      <option value="Inform">Inform</option>
                      <option value="Blocked">Blocked</option>
                    </select>
                  </label>
                  <label>
                    <span>Risk type</span>
                    <select
                      className="input"
                      value={row.riskType}
                      disabled={row.saving}
                      onChange={(e) =>
                        patchRow(p.projectId, { riskType: e.target.value as RiskType })
                      }
                    >
                      <option value="Technical">Technical</option>
                      <option value="Relationship">Relationship</option>
                      <option value="Schedule">Schedule</option>
                      <option value="ExternalDependency">ExternalDependency</option>
                      <option value="Gap">Gap</option>
                      <option value="Resourcing">Resourcing</option>
                    </select>
                  </label>
                </div>
                <label className="weekly-panel-row-text">
                  <span>This week</span>
                  <input
                    type="text"
                    className="input"
                    value={row.latestUpdate}
                    disabled={row.saving}
                    onChange={(e) => patchRow(p.projectId, { latestUpdate: e.target.value })}
                    placeholder="One-line summary"
                  />
                </label>
                <label className="weekly-panel-row-text">
                  <span>Next steps</span>
                  <input
                    type="text"
                    className="input"
                    value={row.nextSteps}
                    disabled={row.saving}
                    onChange={(e) => patchRow(p.projectId, { nextSteps: e.target.value })}
                  />
                </label>
                {row.error && (
                  <div className="weekly-panel-row-error">Failed: {row.error}</div>
                )}
                <div className="weekly-panel-row-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => saveOne(p)}
                    disabled={row.saving}
                  >
                    {row.saving ? 'Saving…' : 'Save this row'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {remaining.length > 0 && (
          <footer className="weekly-panel-foot">
            <button
              type="button"
              className="btn-primary"
              onClick={() => saveAllMutation.mutate()}
              disabled={saveAllMutation.isPending}
            >
              {saveAllMutation.isPending
                ? 'Saving…'
                : `Save all (${remaining.length})`}
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
