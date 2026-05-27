import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PHASES, PROJECT_STATES, type Phase, type ProjectState } from '@torii/shared';
import {
  endpoints,
  PROJECT_DETAIL_FIELDS,
  type MondayItemSnapshot,
  type ProjectDetail,
} from '../api/endpoints.js';
import { PhaseBadge, StateBadge } from '../components/Badge.js';
import { useIsPM } from '../auth/AuthProvider.js';
import { ApiError } from '../api/client.js';
import { AllocationsPanel } from '../components/AllocationsPanel.js';

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
          <div className="detail-hero-title">
            <div className="row gap-2">
              <span className="detail-id mono">{project.id}</span>
              {project.trackerRef && (
                <span className="badge bg-indigo-50 text-indigo-700">
                  {project.trackerRef.provider}
                </span>
              )}
            </div>
            <h1>{project.name}</h1>
            <div className="detail-desc">
              Delivery snapshot for the active phase, key dates, tracker linkage, and allocation coverage.
            </div>
          </div>
          <div className="detail-hero-actions">
            <div className="row gap-2">
              <PhaseBadge phase={project.phase} />
              <StateBadge state={project.state} />
            </div>
            {project.trackerRef && isPM && <RefreshButton projectId={project.id} />}
          </div>
        </div>

        <div className="hero-stat-grid">
          <div className="hero-stat">
            <div className="hero-stat-label">Current phase</div>
            <div className="hero-stat-value">{project.phase}</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-label">Project state</div>
            <div className="hero-stat-value">{project.state}</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-label">Target Go-Live</div>
            <div className="hero-stat-value">{project.keyDates.target_go_live ?? 'TBD'}</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-label">Tracker sync</div>
            <div className="hero-stat-value">{project.trackerRef ? 'Linked' : 'Manual'}</div>
            <div className="hero-stat-sub">{lastSyncLabel}</div>
          </div>
        </div>
      </section>

      <div className="detail-grid">
        <div className="detail-main-col">
          <section className="section-card">
            <div className="section-card-head">
              <h3>Delivery timeline</h3>
            </div>
            <div className="timeline-list">
              {timeline.map((step) => (
                <div key={step.key} className={`timeline-row ${step.status}`}>
                  <div className="timeline-marker" />
                  <div className="timeline-body">
                    <div className="timeline-label">{step.label}</div>
                    <div className="timeline-meta">{step.value ?? 'Not scheduled'}</div>
                  </div>
                  <div className={`timeline-status ${step.status}`}>{step.status}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="section-card">
            <div className="section-card-head">
              <h3>Project settings</h3>
            </div>
            {isPM ? (
              <ProjectEditorPanel project={project} />
            ) : (
              <ProjectReadOnlyPanel project={project} />
            )}
          </section>

          <section className="section-card">
            <div className="section-card-head">
              <h3>Project details</h3>
            </div>
            <ProjectDetailsPanel project={project} canEdit={isPM} />
          </section>
        </div>

        <div className="detail-side-col">
          <section className="section-card">
            <div className="section-card-head">
              <h3>Tracker Sync</h3>
            </div>
            <div className="detail-side-list">
              <div className="detail-side-item">
                <span className="detail-side-label">Source</span>
                <span className="detail-side-value">
                  {project.trackerRef ? project.trackerRef.provider : 'No tracker linked'}
                </span>
              </div>
              <div className="detail-side-item">
                <span className="detail-side-label">External id</span>
                <span className="detail-side-value">{project.trackerRef?.externalId ?? '—'}</span>
              </div>
              <div className="detail-side-item">
                <span className="detail-side-label">Last Sync</span>
                <span className="detail-side-value">{lastSyncLabel}</span>
              </div>
              <a
                className="detail-side-link"
                href="https://github.com/rhaning/torii/blob/main/docs/field-ownership.md"
                target="_blank"
                rel="noreferrer"
                title="How Torii and the tracker share fields"
              >
                Field ownership guide
              </a>
            </div>
          </section>

          <section className="section-card">
            <div className="section-card-head">
              <h3>Key dates</h3>
            </div>
            <div className="detail-side-list">
              <div className="detail-side-item">
                <span className="detail-side-label">Kickoff</span>
                <span className="detail-side-value">{project.keyDates.kickoff ?? '—'}</span>
              </div>
              <div className="detail-side-item">
                <span className="detail-side-label">Target Go-Live</span>
                <span className="detail-side-value">{project.keyDates.target_go_live ?? '—'}</span>
              </div>
              <div className="detail-side-item">
                <span className="detail-side-label">Actual Go-Live</span>
                <span className="detail-side-value">{project.keyDates.actual_go_live ?? '—'}</span>
              </div>
              <div className="detail-side-item">
                <span className="detail-side-label">Hypercare end</span>
                <span className="detail-side-value">{project.keyDates.hypercare_end ?? '—'}</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <AllocationsPanel projectId={project.id} canEdit={isPM} />

      {project.trackerRef && (
        <MondayDetailsPanel trackerRaw={project.trackerRaw} />
      )}

      <button
        type="button"
        className="hidden"
        onClick={() => queryClient.invalidateQueries({ queryKey: ['project', id] })}
      />
    </div>
  );
}

function buildTimeline(project: ProjectDetail): TimelineStep[] {
  const ordered = [
    { key: 'kickoff', label: 'Kickoff', value: project.keyDates.kickoff ?? null },
    {
      key: 'target_go_live',
      label: 'Target Go-Live',
      value: project.keyDates.target_go_live ?? null,
    },
    {
      key: 'actual_go_live',
      label: 'Actual Go-Live',
      value: project.keyDates.actual_go_live ?? null,
    },
    { key: 'hypercare_end', label: 'Hypercare end', value: project.keyDates.hypercare_end ?? null },
  ];

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

function ProjectReadOnlyPanel({ project }: { project: ProjectDetail }) {
  return (
    <div className="detail-settings-grid">
      <KV label="Phase" value={<PhaseBadge phase={project.phase} />} />
      <KV label="State" value={<StateBadge state={project.state} />} />
      <KV label="Kickoff" value={project.keyDates.kickoff ?? '—'} />
      <KV label="Target Go-Live" value={project.keyDates.target_go_live ?? '—'} />
      <KV label="Actual Go-Live" value={project.keyDates.actual_go_live ?? '—'} />
      <KV label="Hypercare end" value={project.keyDates.hypercare_end ?? '—'} />
    </div>
  );
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
                {p}
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
  const editableFields = PROJECT_DETAIL_FIELDS.filter(
    (f) => detailOwner(project, f.key) === 'torii',
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    const seed: Record<string, string> = {};
    for (const f of editableFields) seed[f.key] = project.details?.[f.key] ?? '';
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

  return (
    <div className="detail-settings-grid">
      {PROJECT_DETAIL_FIELDS.map((field) => {
        const value = project.details?.[field.key] ?? '';
        const isEditable = editing && editableFields.some((f) => f.key === field.key);
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
        } else if ('isLink' in field && field.isLink) {
          display = (
            <a href={value} target="_blank" rel="noreferrer" className="text-torii hover:underline">
              {value}
            </a>
          );
        } else {
          display = value;
        }
        return <KV key={field.key} label={field.label} value={display} />;
      })}
      {canEdit && editableFields.length > 0 && (
        <div className="detail-form-actions" style={{ gridColumn: '1 / -1' }}>
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
