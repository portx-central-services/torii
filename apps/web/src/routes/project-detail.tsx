import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PHASES, PROJECT_STATES, phaseLabel, type Phase, type ProjectState } from '@torii/shared';
import {
  endpoints,
  PROJECT_DETAIL_FIELDS,
  PROJECT_DETAIL_FIELD_GROUPS,
  type MondayItemSnapshot,
  type ProjectDetail,
} from '../api/endpoints.js';
import { PhaseBadge, StateBadge, OnBudgetChip } from '../components/Badge.js';
import { useIsPM } from '../auth/AuthProvider.js';
import { ApiError } from '../api/client.js';
import { AllocationsPanel } from '../components/AllocationsPanel.js';
import { HarvestPanel } from '../components/HarvestPanel.js';
import { ReconciliationPanel } from '../components/ReconciliationPanel.js';
import { RiskProjectCard } from './risks.js';

type TimelineStep = {
  key: string;
  label: string;
  value: string | null;
  status: 'done' | 'active' | 'upcoming';
};

export function ProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const isPM = useIsPM();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['project', id],
    queryFn: () => endpoints.getProject(id),
    enabled: !!id,
  });

  // Fetch the multi-Harvest-project snapshot at the parent so both <OnBudgetChip>
  // and <HarvestPanel> can read it from the same cache key. retry:false keeps an
  // empty result distinct from a transient error.
  const harvestSnapQ = useQuery({
    queryKey: ['harvest-snapshot', id],
    queryFn: () => endpoints.getProjectHarvest(id),
    enabled: !!id,
    retry: false,
  });

  if (query.isLoading) return <div className="text-gray-500">Loading project...</div>;
  if (query.isError) {
    return <div className="text-red-700">Unable to load project details: {(query.error as Error).message}</div>;
  }

  const project = query.data;
  if (!project) return <div>Not found</div>;

  const timeline = buildTimeline(project);
  const lastSyncLabel = project.lastSyncedAt
    ? new Date(project.lastSyncedAt).toLocaleString()
    : 'Never Synced';
  const teamFields = PROJECT_DETAIL_FIELD_GROUPS.find((g) => g.group === 'Team')?.fields ?? [];
  const linkFields = PROJECT_DETAIL_FIELD_GROUPS.find((g) => g.group === 'Links')?.fields ?? [];

  return (
    <div className="page-stack">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/projects" className="hover:underline">
          Projects
        </Link>
        <span>/</span>
        <span className="text-gray-700">{project.name}</span>
      </div>

      <section className="detail-hero">
        <div className="detail-hero-row">
          <h1 className="detail-hero-h1">{project.name}</h1>
          <div className="detail-hero-status">
            <div className="status-chip">
              <span className="status-chip-label">Phase</span>
              <PhaseBadge phase={project.phase} />
            </div>
            <div className="status-chip">
              <span className="status-chip-label">State</span>
              <StateBadge state={project.state} />
            </div>
            {harvestSnapQ.data && harvestSnapQ.data.harvestProjects.length > 0 && (
              <div className="status-chip">
                <span className="status-chip-label">Budget</span>
                <OnBudgetChip
                  budgetHours={harvestSnapQ.data.harvestProjects.some((hp) => hp.budgetHours !== null)
                    ? harvestSnapQ.data.harvestProjects.reduce((s, hp) => s + (hp.budgetHours ?? 0), 0)
                    : null}
                  spentBillable={harvestSnapQ.data.harvestProjects.reduce((s, hp) => s + hp.spentHoursBillable, 0)}
                  spentNonbillable={harvestSnapQ.data.harvestProjects.reduce((s, hp) => s + hp.spentHoursNonbillable, 0)}
                />
              </div>
            )}
          </div>
        </div>

        <ol className="timeline-h" aria-label="Delivery timeline">
          {timeline.map((step) => (
            <li key={step.key} className={`timeline-h-step ${step.status}`}>
              <span className="timeline-h-marker" />
              <span className="timeline-h-label">{step.label}</span>
              <span className="timeline-h-date">{step.value ?? 'Not scheduled'}</span>
            </li>
          ))}
        </ol>

        <div className="detail-hero-team">
          <div className="team-row">
            <span className="team-row-label">Customer</span>
            <span className="team-row-value">
              {project.customer ? (
                <Link to={`/customers/${project.customer.id}`} className="text-torii hover:underline">
                  {project.customer.name}
                </Link>
              ) : (
                '—'
              )}
            </span>
          </div>
          {teamFields.map((field) => {
            // Prefer the resolved Person (linked to /people/:id); fall back to the
            // legacy `details.*` string when the FK is null; fall back to em-dash.
            const resolved =
              field.key === 'project_manager'
                ? project.projectManager
                : field.key === 'solution_architect'
                  ? project.solutionArchitect
                  : field.key === 'solution_consultant'
                    ? project.solutionConsultant
                    : null;
            const legacyString = project.details?.[field.key];
            return (
              <div key={field.key} className="team-row">
                <span className="team-row-label">{field.label}</span>
                <span className="team-row-value">
                  {resolved ? (
                    <Link to={`/people/${resolved.id}`} className="text-torii hover:underline">
                      {resolved.name}
                    </Link>
                  ) : (
                    legacyString || '—'
                  )}
                </span>
              </div>
            );
          })}
          {linkFields.map((field) => {
            const value = project.details?.[field.key];
            return (
              <div key={field.key} className="team-row">
                <span className="team-row-label">{field.label}</span>
                <span className="team-row-value">
                  {value ? (
                    <a className="detail-link" href={value} target="_blank" rel="noreferrer">
                      Open ↗
                    </a>
                  ) : (
                    <span className="detail-link-empty">—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section-card">
        <div className="section-card-head">
          <h3>Project details</h3>
        </div>
        <ProjectDetailsPanel project={project} canEdit={isPM} />
      </section>

      {isPM && (
        <section className="section-card">
          <div className="section-card-head">
            <h3>Project settings</h3>
          </div>
          <ProjectEditorPanel project={project} />
          <a
            className="detail-side-link"
            href="https://github.com/rhaning/torii/blob/main/docs/field-ownership.md"
            target="_blank"
            rel="noreferrer"
            title="How Torii and the tracker share fields"
          >
            Field ownership guide
          </a>
        </section>
      )}

      <AllocationsPanel projectId={project.id} canEdit={isPM} teamFields={teamFields} />

      <ReconciliationPanel projectId={project.id} />

      <RiskProjectCard projectId={project.id} headerName="Weekly risk update" linkToProject={false} />

      {project.trackerRef && (
        <MondayDetailsPanel trackerRaw={project.trackerRaw} />
      )}

      <HarvestPanel project={project} isPm={isPM} />

      <div className="detail-sync-footer">
        <div className="detail-sync-meta">
          <span className="detail-id mono">{project.id}</span>
          {project.trackerRef && (
            <>
              <span className="badge bg-indigo-50 text-indigo-700">
                {project.trackerRef.provider}
              </span>
              <span>Last sync {lastSyncLabel}</span>
              {project.trackerRef.externalId && (
                <span className="tracker-meta-id mono">{project.trackerRef.externalId}</span>
              )}
            </>
          )}
        </div>
        {project.trackerRef && isPM && <RefreshButton projectId={project.id} />}
      </div>

      <button
        type="button"
        className="hidden"
        onClick={() => queryClient.invalidateQueries({ queryKey: ['project', id] })}
      />
    </div>
  );
}

/** Add `weeks` weeks to an ISO yyyy-mm-dd date (UTC, no timezone shift). */
function addWeeks(iso: string, weeks: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + weeks * 7);
  return dt.toISOString().slice(0, 10);
}

function buildTimeline(project: ProjectDetail): TimelineStep[] {
  const kickoff = project.keyDates.kickoff ?? null;
  const targetGoLive = project.keyDates.target_go_live ?? null;
  const actualGoLive = project.keyDates.actual_go_live ?? null;
  // Hypercare end defaults to (actual ?? target) + 4 weeks if not explicitly set.
  const baseForHypercare = actualGoLive ?? targetGoLive;
  const hypercareEnd =
    project.keyDates.hypercare_end ?? (baseForHypercare ? addWeeks(baseForHypercare, 4) : null);

  const ordered: Array<{ key: string; label: string; value: string | null }> = [
    { key: 'kickoff', label: 'Kickoff', value: kickoff },
    { key: 'target_go_live', label: 'Target Go-Live', value: targetGoLive },
  ];
  // Actual Go-Live appears in the timeline only when it has been set.
  if (actualGoLive) {
    ordered.push({ key: 'actual_go_live', label: 'Actual Go-Live', value: actualGoLive });
  }
  ordered.push({ key: 'hypercare_end', label: 'Hypercare end', value: hypercareEnd });

  let activeAssigned = false;
  return ordered.map((step) => {
    if (step.value) return { ...step, status: 'done' as const };
    if (!activeAssigned) {
      activeAssigned = true;
      return { ...step, status: 'active' as const };
    }
    return { ...step, status: 'upcoming' as const };
  });
}

function ProjectEditorPanel({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>(project.phase);
  const [state, setState] = useState<ProjectState>(project.state);
  const [kickoff, setKickoff] = useState(project.keyDates.kickoff ?? '');
  const [targetGoLive, setTargetGoLive] = useState(project.keyDates.target_go_live ?? '');
  const [actualGoLive, setActualGoLive] = useState(project.keyDates.actual_go_live ?? '');
  const [hypercareEnd, setHypercareEnd] = useState(project.keyDates.hypercare_end ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setPhase(project.phase);
    setState(project.state);
    setKickoff(project.keyDates.kickoff ?? '');
    setTargetGoLive(project.keyDates.target_go_live ?? '');
    setActualGoLive(project.keyDates.actual_go_live ?? '');
    setHypercareEnd(project.keyDates.hypercare_end ?? '');
  }, [project]);

  const mutation = useMutation({
    mutationFn: async () => {
      const keyDates: Record<string, string> = {};
      if (kickoff) keyDates.kickoff = kickoff;
      if (targetGoLive) keyDates.target_go_live = targetGoLive;
      if (actualGoLive) keyDates.actual_go_live = actualGoLive;
      if (hypercareEnd) keyDates.hypercare_end = hypercareEnd;
      return endpoints.updateProject(project.id, {
        phase,
        state,
        keyDates,
      });
    },
    onSuccess: async () => {
      setSavedAt(Date.now());
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Save failed'),
  });

  return (
    <form
      className="detail-editor-form"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        mutation.mutate();
      }}
    >
      <div className="detail-settings-grid">
        <label className="block">
          <span className="field-label">Phase</span>
          <select className="input w-full" value={phase} onChange={(e) => setPhase(e.target.value as Phase)}>
            {PHASES.map((p) => (
              <option key={p} value={p}>
                {phaseLabel(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">State</span>
          <select className="input w-full" value={state} onChange={(e) => setState(e.target.value as ProjectState)}>
            {PROJECT_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <DateField label="Kickoff" value={kickoff} onChange={setKickoff} />
        <DateField label="Target Go-Live" value={targetGoLive} onChange={setTargetGoLive} />
        <DateField label="Actual Go-Live" value={actualGoLive} onChange={setActualGoLive} />
        <DateField label="Hypercare end" value={hypercareEnd} onChange={setHypercareEnd} />
      </div>
      {err && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">{err}</div>}
      <div className="detail-form-actions">
        {savedAt && !mutation.isPending && (
          <span className="text-xs text-gray-500">Saved {new Date(savedAt).toLocaleTimeString()}</span>
        )}
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function DateField({
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
      <input type="date" className="input w-full" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="detail-kv">
      <div className="detail-kv-label">{label}</div>
      <div className="detail-kv-value">{value}</div>
    </div>
  );
}

function detailOwner(project: ProjectDetail, key: string): 'torii' | 'monday' {
  const mapped = project.fieldMapping?.[`details.${key}`];
  if (mapped === 'torii' || mapped === 'monday') return mapped;
  // Default: only primary_contact is Torii-managed; the rest come from Monday.
  return key === 'primary_contact' ? 'torii' : 'monday';
}

function ProjectDetailsPanel({
  project,
  canEdit,
}: {
  project: ProjectDetail;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const editableKeys = new Set(
    PROJECT_DETAIL_FIELDS.filter((f) => detailOwner(project, f.key) === 'torii').map((f) => f.key),
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    const seed: Record<string, string> = {};
    for (const f of PROJECT_DETAIL_FIELDS) {
      if (editableKeys.has(f.key)) seed[f.key] = project.details?.[f.key] ?? '';
    }
    setDraft(seed);
    setErr(null);
    setEditing(true);
  }

  const mutation = useMutation({
    mutationFn: () => endpoints.updateProject(project.id, { details: draft }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setEditing(false);
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Save failed'),
  });

  // Team and Links are surfaced in the page header; this panel covers the rest.
  const groups = PROJECT_DETAIL_FIELD_GROUPS.filter(
    (g) => g.group !== 'Team' && g.group !== 'Links',
  );

  return (
    <div className="detail-groups">
      {groups.map(({ group, fields }) => (
        <div key={group} className="detail-group">
          <div className="detail-group-label">{group}</div>
          <div className="detail-group-fields">
            {fields.map((field) => {
              const value = project.details?.[field.key] ?? '';
              const isEditable = editing && editableKeys.has(field.key);
              // Link fields render the label itself as an accented hyperlink.
              if ('isLink' in field && field.isLink && !isEditable) {
                return (
                  <div key={field.key} className="detail-kv">
                    {value ? (
                      <a className="detail-link" href={value} target="_blank" rel="noreferrer">
                        {field.label}
                      </a>
                    ) : (
                      <>
                        <div className="detail-kv-label">{field.label}</div>
                        <div className="detail-kv-value">—</div>
                      </>
                    )}
                  </div>
                );
              }
              let display: ReactNode;
              if (isEditable) {
                display = (
                  <input
                    className="input w-full"
                    value={draft[field.key] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                  />
                );
              } else if (!value) {
                display = '—';
              } else {
                display = value;
              }
              return <KV key={field.key} label={field.label} value={display} />;
            })}
          </div>
        </div>
      ))}
      {canEdit && editableKeys.size > 0 && (
        <div className="detail-form-actions detail-actions-full">
          {err && <span className="text-xs text-red-700">{err}</span>}
          {editing ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditing(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Saving...' : 'Save details'}
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary" onClick={startEdit}>
              Edit details
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MondayDetailsPanel({ trackerRaw }: { trackerRaw: MondayItemSnapshot | null }) {
  const [showRaw, setShowRaw] = useState(false);

  if (!trackerRaw) {
    return (
      <section className="section-card">
        <div className="section-card-head">
          <h3>Monday details</h3>
        </div>
        <div className="text-sm text-gray-500">
          No snapshot yet. Click Sync from tracker to fetch the latest item data.
        </div>
      </section>
    );
  }

  const columns = trackerRaw.column_values ?? [];
  const populated = columns.filter((c) => (c.text ?? '').trim().length > 0);

  return (
    <section className="section-card">
      <div className="section-card-head">
        <h3>Monday details</h3>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
        </button>
      </div>
      <div className="detail-side-list">
        <div className="detail-side-item">
          <span className="detail-side-label">Monday item id</span>
          <span className="detail-side-value mono">{trackerRaw.id ?? '—'}</span>
        </div>
        <div className="detail-side-item">
          <span className="detail-side-label">Row title</span>
          <span className="detail-side-value">{trackerRaw.name ?? '—'}</span>
        </div>
      </div>
      {populated.length > 0 ? (
        <table className="tbl">
          <thead>
            <tr>
              <th>Column</th>
              <th>Value</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {populated.map((c) => (
              <tr key={c.id}>
                <td>{c.column?.title ?? c.id}</td>
                <td>{c.text}</td>
                <td className="text-xs text-gray-500">{c.type ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-sm text-gray-500 mt-2">No populated columns on this item.</div>
      )}
      {showRaw && (
        <pre
          className="mono text-xs mt-3 p-3 rounded bg-gray-50 border border-gray-200"
          style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {JSON.stringify(trackerRaw, null, 2)}
        </pre>
      )}
    </section>
  );
}

function RefreshButton({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => endpoints.refreshProject(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Refresh failed'),
  });

  return (
    <div className="detail-refresh-wrap">
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          setErr(null);
          mutation.mutate();
        }}
        disabled={mutation.isPending}
      >
          {mutation.isPending ? 'Syncing...' : 'Sync from tracker'}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
