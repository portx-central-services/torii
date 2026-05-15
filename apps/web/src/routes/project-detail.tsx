import { useEffect, useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PHASES,
  PROJECT_STATES,
  type Phase,
  type ProjectState,
} from '@torii/shared';
import { endpoints, type ProjectDetail } from '../api/endpoints.js';
import { PhaseBadge, StateBadge } from '../components/Badge.js';
import { useIsPM } from '../auth/AuthProvider.js';
import { ApiError } from '../api/client.js';
import { AllocationsPanel } from '../components/AllocationsPanel.js';

export function ProjectDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const isPM = useIsPM();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['project', id],
    queryFn: () => endpoints.getProject(id),
    enabled: !!id,
  });

  if (query.isLoading) return <div className="text-gray-500">Loading…</div>;
  if (query.isError) {
    return (
      <div className="text-red-700">
        Failed to load project: {(query.error as Error).message}
      </div>
    );
  }
  const project = query.data;
  if (!project) return <div>Not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/projects" className="hover:underline">
          Projects
        </Link>
        <span>/</span>
        <span className="text-gray-700">{project.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{project.name}</h1>
          <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
            {project.trackerRef && (
              <>
                <span className="badge bg-indigo-50 text-indigo-700">
                  {project.trackerRef.provider}
                </span>
                <span>
                  Last sync:{' '}
                  {project.lastSyncedAt
                    ? new Date(project.lastSyncedAt).toLocaleString()
                    : 'never'}
                </span>
                {isPM && <RefreshButton projectId={project.id} />}
                <a
                  className="text-xs text-gray-500 hover:text-torii hover:underline"
                  href="https://github.com/rhaning/torii/blob/main/docs/field-ownership.md"
                  target="_blank"
                  rel="noreferrer"
                  title="How Torii and the tracker share fields"
                >
                  Field ownership ↗
                </a>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PhaseBadge phase={project.phase} />
          <StateBadge state={project.state} />
        </div>
      </div>

      {isPM ? (
        <ProjectEditorPanel project={project} />
      ) : (
        <ProjectReadOnlyPanel project={project} />
      )}

      <AllocationsPanel projectId={project.id} canEdit={isPM} />

      {/* Re-query helper so refresh button forces fresh data */}
      <button
        type="button"
        className="hidden"
        onClick={() => queryClient.invalidateQueries({ queryKey: ['project', id] })}
      />
    </div>
  );
}

function ProjectReadOnlyPanel({ project }: { project: ProjectDetail }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
      <KV label="Phase" value={<PhaseBadge phase={project.phase} />} />
      <KV label="State" value={<StateBadge state={project.state} />} />
      <KV label="Kickoff" value={project.keyDates.kickoff ?? '—'} />
      <KV label="Target go-live" value={project.keyDates.target_go_live ?? '—'} />
      <KV label="Actual go-live" value={project.keyDates.actual_go_live ?? '—'} />
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
      className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs text-gray-600 block mb-1">Phase</span>
          <select
            className="input w-full"
            value={phase}
            onChange={(e) => setPhase(e.target.value as Phase)}
          >
            {PHASES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-600 block mb-1">State</span>
          <select
            className="input w-full"
            value={state}
            onChange={(e) => setState(e.target.value as ProjectState)}
          >
            {PROJECT_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <DateField label="Kickoff" value={kickoff} onChange={setKickoff} />
        <DateField label="Target go-live" value={targetGoLive} onChange={setTargetGoLive} />
        <DateField label="Actual go-live" value={actualGoLive} onChange={setActualGoLive} />
        <DateField label="Hypercare end" value={hypercareEnd} onChange={setHypercareEnd} />
      </div>
      {err && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">
          {err}
        </div>
      )}
      <div className="flex items-center justify-end gap-3">
        {savedAt && !mutation.isPending && (
          <span className="text-xs text-gray-500">Saved {new Date(savedAt).toLocaleTimeString()}</span>
        )}
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save changes'}
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
      <span className="text-xs text-gray-600 block mb-1">{label}</span>
      <input
        type="date"
        className="input w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-gray-800">{value}</div>
    </div>
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
    <span className="flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary text-xs"
        onClick={() => {
          setErr(null);
          mutation.mutate();
        }}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? 'Refreshing…' : 'Refresh from tracker'}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}
