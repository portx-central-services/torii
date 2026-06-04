import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  endpoints,
  RAG_LEVELS,
  RISK_STATES,
  RISK_TYPES,
  type ProjectRiskUpdate,
  type ProjectRiskUpdateUpsert,
  type RagLevel,
  type RiskListItem,
  type RiskState,
  type RiskType,
  type StaleRiskRow,
} from '../api/endpoints.js';
import { useIsPM } from '../auth/AuthProvider.js';
import { ApiError } from '../api/client.js';
import { WeeklyUpdatePanel } from '../components/WeeklyUpdatePanel.js';

const RAG_RANK: Record<RagLevel, number> = { Green: 0, Amber: 1, Red: 2 };

export function RisksPage() {
  const isPM = useIsPM();
  const [panelOpen, setPanelOpen] = useState(false);
  const [focusProjectId, setFocusProjectId] = useState<string | null>(null);

  const risks = useQuery({
    queryKey: ['risks', 'with-stale'],
    queryFn: () => endpoints.listRisksWithStale(),
  });

  if (risks.isLoading) {
    return <div className="text-gray-500">Loading risks…</div>;
  }
  if (risks.isError) {
    return (
      <div className="text-red-700">
        Unable to load risks: {(risks.error as Error).message}
      </div>
    );
  }

  const atRisk = risks.data?.atRisk ?? [];
  const stale = risks.data?.stale ?? [];
  const redCount = atRisk.filter((r) => r.ragLevel === 'Red').length;
  const amberCount = atRisk.filter((r) => r.ragLevel === 'Amber').length;
  const groups = groupByCustomer(atRisk);

  function openPanelFor(projectId: string | null) {
    setFocusProjectId(projectId);
    setPanelOpen(true);
  }

  return (
    <div className="page-stack">
      <div className="page-header">
        <div className="page-header-title">
          <span className="overline">Delivery Health</span>
          <h1>Risks</h1>
          <div className="page-sub">Weekly RAG cadence, grouped by customer.</div>
        </div>
        {isPM && (
          <div className="page-header-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => openPanelFor(null)}
            >
              Update my week
            </button>
          </div>
        )}
      </div>

      <div className="kpi-row">
        <div className="kpi accent">
          <div className="kpi-label">At risk</div>
          <div className="kpi-value">{atRisk.length}</div>
          <div className="kpi-sub">Red or Amber this week</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Red</div>
          <div className="kpi-value kpi-danger">{redCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Amber</div>
          <div className="kpi-value kpi-warning">{amberCount}</div>
        </div>
      </div>

      {atRisk.length === 0 ? (
        <div className="section-card empty">
          <div className="text-base text-gray-700 mb-2">All clear</div>
          <div className="text-sm text-gray-500">
            No projects currently have a non-Green RAG for this week.
          </div>
        </div>
      ) : (
        <div className="risks-groups">
          {groups.map((group) => (
            <CustomerGroup key={group.customerId ?? '__none__'} group={group} />
          ))}
        </div>
      )}

      {stale.length > 0 && (
        <StaleSection
          rows={stale}
          isPM={isPM}
          onUpdateNow={(projectId) => openPanelFor(projectId)}
        />
      )}

      <WeeklyUpdatePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        focusProjectId={focusProjectId}
      />
    </div>
  );
}

interface CustomerGroupData {
  customerId: string | null;
  customerName: string | null;
  items: RiskListItem[];
}

function groupByCustomer(items: RiskListItem[]): CustomerGroupData[] {
  const map = new Map<string, CustomerGroupData>();
  for (const it of items) {
    const key = it.customerId ?? '__none__';
    let group = map.get(key);
    if (!group) {
      group = { customerId: it.customerId, customerName: it.customerName, items: [] };
      map.set(key, group);
    }
    group.items.push(it);
  }
  return [...map.values()].sort((a, b) => {
    if (a.customerId === null && b.customerId === null) return 0;
    if (a.customerId === null) return 1;
    if (b.customerId === null) return -1;
    return (a.customerName ?? '').localeCompare(b.customerName ?? '');
  });
}

function CustomerGroup({ group }: { group: CustomerGroupData }) {
  const redCount = group.items.filter((it) => it.ragLevel === 'Red').length;
  const amberCount = group.items.filter((it) => it.ragLevel === 'Amber').length;
  return (
    <section className="risks-group">
      <header className="risks-group-head">
        <h2 className="risks-group-name">
          {group.customerId && group.customerName ? (
            <Link to={`/customers/${group.customerId}`} className="text-torii hover:underline">
              {group.customerName}
            </Link>
          ) : (
            <span className="dashboard-em">No customer</span>
          )}
        </h2>
        <span className="risks-group-count">
          {group.items.length} project{group.items.length === 1 ? '' : 's'}
          {redCount > 0 && <> · <span className="kpi-danger">{redCount} red</span></>}
          {amberCount > 0 && <> · <span className="kpi-warning">{amberCount} amber</span></>}
        </span>
      </header>
      <div className="risks-list">
        {group.items.map((item) => (
          <RiskProjectCard
            key={item.projectId}
            projectId={item.projectId}
            headerName={item.projectName}
          />
        ))}
      </div>
    </section>
  );
}

function StaleSection({
  rows,
  isPM,
  onUpdateNow,
}: {
  rows: StaleRiskRow[];
  isPM: boolean;
  onUpdateNow: (projectId: string) => void;
}) {
  return (
    <section className="section-card">
      <h2 style={{ marginTop: 0 }}>Stale updates</h2>
      <div className="text-sm text-gray-500" style={{ marginBottom: 12 }}>
        Projects whose most recent update is more than 2 weeks old, or that have no updates yet.
      </div>
      <table className="stale-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--ink-200)', textAlign: 'left' }}>
            <th style={{ padding: '8px 8px' }}>Project</th>
            <th style={{ padding: '8px 8px' }}>Customer</th>
            <th style={{ padding: '8px 8px' }}>Last RAG</th>
            <th style={{ padding: '8px 8px' }}>Last week</th>
            <th style={{ padding: '8px 8px' }}>Stale</th>
            {isPM && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.projectId} style={{ borderBottom: '1px solid var(--ink-100)' }}>
              <td style={{ padding: '8px 8px' }}>
                <Link to={`/projects/${row.projectId}`} className="text-torii hover:underline">
                  {row.projectName}
                </Link>
              </td>
              <td style={{ padding: '8px 8px' }}>
                {row.customerId && row.customerName ? (
                  <Link to={`/customers/${row.customerId}`} className="text-torii hover:underline">
                    {row.customerName}
                  </Link>
                ) : (
                  <span className="dashboard-em">—</span>
                )}
              </td>
              <td style={{ padding: '8px 8px' }}>
                {row.lastRagLevel ? <RagChip level={row.lastRagLevel} /> : <span className="dashboard-em">—</span>}
              </td>
              <td style={{ padding: '8px 8px' }}>
                {row.lastWeekOf ?? <span className="dashboard-em">—</span>}
              </td>
              <td style={{ padding: '8px 8px' }}>
                {row.weeksSinceLastUpdate === null ? (
                  <span className="stale-chip stale-chip-never">never</span>
                ) : (
                  <span className="stale-chip">{row.weeksSinceLastUpdate}w ago</span>
                )}
              </td>
              {isPM && (
                <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => onUpdateNow(row.projectId)}
                  >
                    Update now
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function RiskProjectCard({
  projectId,
  headerName,
  /**
   * When true (the default), the heading is a link to the project's detail page.
   * Set to false when embedding the card on the project's own detail page.
   */
  linkToProject = true,
}: {
  projectId: string;
  headerName: string;
  linkToProject?: boolean;
}) {
  const isPM = useIsPM();
  const history = useQuery({
    queryKey: ['risk-updates', projectId],
    queryFn: () => endpoints.getProjectRiskUpdates(projectId),
  });

  const updates = history.data ?? [];
  const current = updates[0];
  const previous = updates[1];

  const [editing, setEditing] = useState(false);

  return (
    <section className="section-card">
      <div className="section-card-head">
        <h3>
          {linkToProject ? (
            <Link to={`/projects/${projectId}`} className="text-torii hover:underline">
              {headerName}
            </Link>
          ) : (
            headerName
          )}
        </h3>
        {isPM && !editing && (
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            Edit this week
          </button>
        )}
      </div>

      {history.isLoading ? (
        <div className="text-sm text-gray-500">Loading history…</div>
      ) : editing && isPM ? (
        <RiskEditForm
          projectId={projectId}
          initial={current}
          onCancel={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : !current ? (
        <div className="text-sm text-gray-500">
          No risk updates yet for this project.
          {isPM && (
            <>
              {' '}
              <button
                type="button"
                className="text-torii hover:underline"
                onClick={() => setEditing(true)}
              >
                Add the first
              </button>
              .
            </>
          )}
        </div>
      ) : (
        <CurrentRiskCard update={current} previous={previous ?? null} history={updates} />
      )}
    </section>
  );
}

function CurrentRiskCard({
  update,
  previous,
  history,
}: {
  update: ProjectRiskUpdate;
  previous: ProjectRiskUpdate | null;
  history: ProjectRiskUpdate[];
}) {
  return (
    <div className="risk-card">
      <div className="risk-card-head">
        <RagChip level={update.ragLevel} />
        <TrendChip current={update.ragLevel} previous={previous?.ragLevel ?? null} />
        <WeeksStuckChip history={history} />
        <span className="risk-card-week">Week of {update.weekOf}</span>
        <RiskStateBadge state={update.state} />
        <div className="risk-card-types">
          {update.riskTypes.map((t) => (
            <span key={t} className="badge bg-gray-100 text-gray-700">
              {t}
            </span>
          ))}
        </div>
      </div>
      <RiskDetailTable update={update} history={history} />
      <div className="text-xs text-gray-500 mt-2">
        Last updated by {update.authorName ?? update.authorId} at{' '}
        {new Date(update.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}

/**
 * Two-column label/value table. The Description / History row carries:
 *   - the standing `description` text
 *   - a "This week:" line with the current week's `latestUpdate`
 *   - an inline "View N earlier weeks" disclosure expanding to per-week sub-tables
 */
function RiskDetailTable({
  update,
  history,
}: {
  update: ProjectRiskUpdate;
  history: ProjectRiskUpdate[];
}) {
  const [showHistory, setShowHistory] = useState(false);
  const olderHistory = history.slice(1);
  return (
    <dl className="risk-table">
      <dt>Description / History</dt>
      <dd>
        <FieldText value={update.description} />
        {update.latestUpdate?.trim() && (
          <div className="risk-table-this-week">
            <span className="risk-table-this-week-label">This week:</span> {update.latestUpdate}
          </div>
        )}
        {olderHistory.length > 0 && (
          <div className="risk-table-history">
            <button
              type="button"
              className="text-sm text-gray-600 hover:underline"
              onClick={() => setShowHistory((v) => !v)}
            >
              {showHistory
                ? 'Hide earlier weeks'
                : `View ${olderHistory.length} earlier week${olderHistory.length === 1 ? '' : 's'}`}
            </button>
            {showHistory && (
              <div className="risk-history-list">
                {olderHistory.map((u) => (
                  <PastRiskRow key={u.id} update={u} />
                ))}
              </div>
            )}
          </div>
        )}
      </dd>

      <dt>Go-to-green plan</dt>
      <dd><FieldText value={update.goToGreenPlan} /></dd>

      <dt>Next steps</dt>
      <dd><FieldText value={update.nextSteps} /></dd>

      <dt>Action Requested</dt>
      <dd><FieldText value={update.actionRequested} /></dd>
    </dl>
  );
}

function FieldText({ value }: { value: string }) {
  if (!value?.trim()) return <span className="text-gray-400">—</span>;
  return <span className="risk-field-value">{value}</span>;
}

function PastRiskRow({ update }: { update: ProjectRiskUpdate }) {
  return (
    <details className="risk-history-row">
      <summary>
        <RagChip level={update.ragLevel} />
        <span className="risk-card-week">Week of {update.weekOf}</span>
        <RiskStateBadge state={update.state} />
      </summary>
      <dl className="risk-table risk-table-nested">
        <dt>Description / History</dt>
        <dd>
          <FieldText value={update.description} />
          {update.latestUpdate?.trim() && (
            <div className="risk-table-this-week">
              <span className="risk-table-this-week-label">This week:</span> {update.latestUpdate}
            </div>
          )}
        </dd>
        <dt>Go-to-green plan</dt>
        <dd><FieldText value={update.goToGreenPlan} /></dd>
        <dt>Next steps</dt>
        <dd><FieldText value={update.nextSteps} /></dd>
        <dt>Action Requested</dt>
        <dd><FieldText value={update.actionRequested} /></dd>
      </dl>
    </details>
  );
}

function TrendChip({
  current,
  previous,
}: {
  current: RagLevel;
  previous: RagLevel | null;
}) {
  if (previous === null) {
    return <span className="trend-chip trend-chip-new">New</span>;
  }
  if (previous === 'Green' && current !== 'Green') {
    return <span className="trend-chip trend-chip-worse">Returned from Green</span>;
  }
  if (current === previous) {
    return <span className="trend-chip trend-chip-same">Same</span>;
  }
  const delta = RAG_RANK[current] - RAG_RANK[previous];
  if (delta > 0) {
    return (
      <span className="trend-chip trend-chip-worse" title={`${previous} → ${current}`}>
        ↑ Worsened from {previous}
      </span>
    );
  }
  return (
    <span className="trend-chip trend-chip-better" title={`${previous} → ${current}`}>
      ↓ Improved from {previous}
    </span>
  );
}

/**
 * Counts consecutive weeks at the current non-Green level, walking history
 * backward from the most recent entry. Renders nothing when the streak is < 2
 * (a 1-week-old red is noise, not signal).
 */
function WeeksStuckChip({ history }: { history: ProjectRiskUpdate[] }) {
  if (history.length === 0) return null;
  const current = history[0]!;
  if (current.ragLevel === 'Green') return null;
  let streak = 1;
  for (let i = 1; i < history.length; i++) {
    if (history[i]!.ragLevel === current.ragLevel) streak += 1;
    else break;
  }
  if (streak < 2) return null;
  return (
    <span className={`trend-chip trend-chip-stuck rag-${current.ragLevel.toLowerCase()}`}>
      Stuck {streak} weeks at {current.ragLevel}
    </span>
  );
}

function RagChip({ level }: { level: RagLevel }) {
  return <span className={`rag-chip rag-${level.toLowerCase()}`}>{level}</span>;
}

function RiskStateBadge({ state }: { state: RiskState }) {
  return (
    <span
      className={
        state === 'Blocked'
          ? 'badge bg-red-50 text-red-700'
          : 'badge bg-blue-50 text-blue-700'
      }
    >
      {state}
    </span>
  );
}

function RiskEditForm({
  projectId,
  initial,
  onCancel,
  onSaved,
}: {
  projectId: string;
  initial: ProjectRiskUpdate | undefined;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [ragLevel, setRagLevel] = useState<RagLevel>(initial?.ragLevel ?? 'Amber');
  const [riskTypes, setRiskTypes] = useState<Set<RiskType>>(
    new Set(initial?.riskTypes ?? ['Technical']),
  );
  const [state, setState] = useState<RiskState>(initial?.state ?? 'Inform');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [goToGreenPlan, setGoToGreenPlan] = useState(initial?.goToGreenPlan ?? '');
  const [latestUpdate, setLatestUpdate] = useState(initial?.latestUpdate ?? '');
  const [nextSteps, setNextSteps] = useState(initial?.nextSteps ?? '');
  const [actionRequested, setActionRequested] = useState(initial?.actionRequested ?? '');
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (riskTypes.size === 0) throw new Error('Select at least one risk type');
      const body: ProjectRiskUpdateUpsert = {
        ragLevel,
        riskTypes: Array.from(riskTypes),
        state,
        description,
        goToGreenPlan,
        latestUpdate,
        nextSteps,
        actionRequested,
      };
      return endpoints.upsertProjectRiskUpdate(projectId, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['risk-updates', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['risks'] });
      onSaved();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : (e as Error).message),
  });

  function toggleType(t: RiskType) {
    setRiskTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  return (
    <form
      className="risk-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className="field-label">RAG level</span>
          <select className="input w-full" value={ragLevel} onChange={(e) => setRagLevel(e.target.value as RagLevel)}>
            {RAG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">State</span>
          <select className="input w-full" value={state} onChange={(e) => setState(e.target.value as RiskState)}>
            {RISK_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="block">
          <span className="field-label">Risk type(s)</span>
          <div className="risk-type-grid">
            {RISK_TYPES.map((t) => (
              <label key={t} className="risk-type-check">
                <input
                  type="checkbox"
                  checked={riskTypes.has(t)}
                  onChange={() => toggleType(t)}
                />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <TextAreaField label="Description / History" value={description} onChange={setDescription} />
      <TextAreaField label="Go-to-green plan" value={goToGreenPlan} onChange={setGoToGreenPlan} />
      <TextAreaField label="This week" value={latestUpdate} onChange={setLatestUpdate} />
      <TextAreaField label="Next steps" value={nextSteps} onChange={setNextSteps} />
      <TextAreaField label="Action Requested" value={actionRequested} onChange={setActionRequested} />

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">{err}</div>
      )}
      <div className="detail-form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save this week'}
        </button>
      </div>
    </form>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <textarea
        className="input w-full"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

