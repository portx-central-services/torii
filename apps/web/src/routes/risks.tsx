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
  type RiskState,
  type RiskType,
} from '../api/endpoints.js';
import { useIsPM } from '../auth/AuthProvider.js';
import { ApiError } from '../api/client.js';

export function RisksPage() {
  const risks = useQuery({
    queryKey: ['risks'],
    queryFn: () => endpoints.listRisks(),
  });

  if (risks.isLoading) {
    return <div className="text-gray-500">Loading risks…</div>;
  }
  if (risks.isError) {
    return <div className="text-red-700">Unable to load risks: {(risks.error as Error).message}</div>;
  }

  const items = risks.data ?? [];
  const redCount = items.filter((r) => r.ragLevel === 'Red').length;
  const amberCount = items.filter((r) => r.ragLevel === 'Amber').length;

  return (
    <div className="page-stack">
      <div className="page-header">
        <div className="page-header-title">
          <span className="overline">Delivery Health</span>
          <h1>Risks</h1>
          <div className="page-sub">Weekly RAG cadence for every project currently off-Green.</div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi accent">
          <div className="kpi-label">At risk</div>
          <div className="kpi-value">{items.length}</div>
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

      {items.length === 0 ? (
        <div className="section-card empty">
          <div className="text-base text-gray-700 mb-2">All clear</div>
          <div className="text-sm text-gray-500">
            No projects currently have a non-Green RAG for this week.
          </div>
        </div>
      ) : (
        <div className="risks-list">
          {items.map((item) => (
            <RiskProjectCard key={item.projectId} projectId={item.projectId} headerName={item.projectName} />
          ))}
        </div>
      )}
    </div>
  );
}

export function RiskProjectCard({
  projectId,
  headerName,
  /**
   * When true (the default), the heading is a link to the project's detail page —
   * useful on `/risks` where the card is the only entry point. Set to false when
   * embedding the card ON the project's own detail page, since a self-link there
   * is redundant noise.
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
  const olderHistory = updates.slice(1);

  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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
        // Editing comes first: when the PM clicks "Add the first" on a project with
        // no prior updates, `current` is still undefined — checking `!current` before
        // `editing` would short-circuit back to the empty state instead of opening
        // the form. RiskEditForm handles `initial: undefined` with sensible defaults.
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
        <>
          <CurrentRiskCard update={current} previous={previous ?? null} />
          {olderHistory.length > 0 && (
            <div className="risk-history">
              <button
                type="button"
                className="text-sm text-gray-600 hover:underline"
                onClick={() => setShowHistory((v) => !v)}
              >
                {showHistory ? 'Hide previous weeks' : `Show previous weeks (${olderHistory.length})`}
              </button>
              {showHistory && (
                <div className="risk-history-list">
                  {olderHistory.map((u) => (
                    <PastRiskCard key={u.id} update={u} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CurrentRiskCard({
  update,
  previous,
}: {
  update: ProjectRiskUpdate;
  previous: ProjectRiskUpdate | null;
}) {
  return (
    <div className="risk-card">
      <div className="risk-card-head">
        <RagChip level={update.ragLevel} />
        <RagArrow current={update.ragLevel} previous={previous?.ragLevel ?? null} />
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
      <RiskBody update={update} />
      <div className="risk-card-prev-week text-xs text-gray-500 mt-2">
        {previous
          ? `Last week: ${previous.ragLevel} / ${previous.state}`
          : 'Last week: no update'}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Last updated by {update.authorName ?? update.authorId} at{' '}
        {new Date(update.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}

function PastRiskCard({ update }: { update: ProjectRiskUpdate }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="risk-card past">
      <button
        type="button"
        className="risk-card-head as-button"
        onClick={() => setExpanded((v) => !v)}
      >
        <RagChip level={update.ragLevel} />
        <span className="risk-card-week">Week of {update.weekOf}</span>
        <RiskStateBadge state={update.state} />
        <span className="ml-auto text-xs text-gray-500">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && <RiskBody update={update} />}
    </div>
  );
}

function RiskBody({ update }: { update: ProjectRiskUpdate }) {
  return (
    <div className="risk-body">
      <RiskField label="Description / History" value={update.description} />
      <RiskField label="Go-to-Green plan" value={update.goToGreenPlan} />
      <RiskField label="Latest update" value={update.latestUpdate} />
      <RiskField label="Next steps" value={update.nextSteps} />
      <RiskField label="Action requested" value={update.actionRequested} />
    </div>
  );
}

function RiskField({ label, value }: { label: string; value: string }) {
  return (
    <div className="risk-field">
      <div className="risk-field-label">{label}</div>
      <div className="risk-field-value">{value?.trim() ? value : <span className="text-gray-400">—</span>}</div>
    </div>
  );
}

function RagChip({ level }: { level: RagLevel }) {
  return <span className={`rag-chip rag-${level.toLowerCase()}`}>{level}</span>;
}

function RagArrow({
  current,
  previous,
}: {
  current: RagLevel;
  previous: RagLevel | null;
}) {
  if (!previous) return null;
  const rank: Record<RagLevel, number> = { Green: 0, Amber: 1, Red: 2 };
  const delta = rank[current] - rank[previous];
  if (delta === 0) {
    return (
      <span className="rag-arrow" title={`No change from last week (${previous})`}>
        =
      </span>
    );
  }
  // delta > 0 means worse (Green → Amber → Red).
  const symbol = delta > 0 ? '▲' : '▼';
  const tone = delta > 0 ? 'rag-arrow-worse' : 'rag-arrow-better';
  return (
    <span className={`rag-arrow ${tone}`} title={`${previous} → ${current}`}>
      {symbol} {previous} → {current}
    </span>
  );
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
      <TextAreaField label="Go-to-Green plan" value={goToGreenPlan} onChange={setGoToGreenPlan} />
      <TextAreaField label="Latest update" value={latestUpdate} onChange={setLatestUpdate} />
      <TextAreaField label="Next steps" value={nextSteps} onChange={setNextSteps} />
      <TextAreaField label="Action requested" value={actionRequested} onChange={setActionRequested} />

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
