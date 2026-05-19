import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { PHASES, PROJECT_STATES, type Phase, type ProjectState } from '@torii/shared';
import { endpoints, type Project } from '../api/endpoints.js';
import { PhaseBadge, StateBadge } from '../components/Badge.js';
import { Modal } from '../components/Modal.js';
import { useIsPM } from '../auth/AuthProvider.js';
import { ApiError } from '../api/client.js';

interface Filters {
  phase: Phase | '';
  state: ProjectState | '';
  owner: string;
}

const columnHelper = createColumnHelper<Project>();

export function ProjectsListPage() {
  const isPM = useIsPM();
  const [filters, setFilters] = useState<Filters>({ phase: '', state: '', owner: '' });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [createOpen, setCreateOpen] = useState(false);

  const query = useQuery({
    queryKey: ['projects', filters],
    queryFn: () =>
      endpoints.listProjects({
        phase: filters.phase || undefined,
        state: filters.state || undefined,
        owner: filters.owner || undefined,
      }),
  });

  const projects = query.data ?? [];
  const now = Date.now();
  const ms60d = 60 * 24 * 60 * 60 * 1000;
  const onTrack = projects.filter((p) => p.state === 'OnTrack').length;
  const atRisk = projects.filter((p) => p.state === 'AtRisk').length;
  const blocked = projects.filter((p) => p.state === 'Blocked').length;
  const goingLiveSoon = projects.filter((p) => {
    const target = p.keyDates.target_go_live;
    if (!target) return false;
    const ts = new Date(target).getTime();
    return ts >= now && ts - now <= ms60d;
  }).length;

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Name',
        cell: (ctx) => (
          <Link to={`/projects/${ctx.row.original.id}`} className="text-torii hover:underline">
            {ctx.getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor('phase', {
        header: 'Phase',
        cell: (ctx) => <PhaseBadge phase={ctx.getValue()} />,
      }),
      columnHelper.accessor('state', {
        header: 'State',
        cell: (ctx) => <StateBadge state={ctx.getValue()} />,
      }),
      columnHelper.accessor('ownerId', {
        header: 'Owner',
        cell: (ctx) => ctx.getValue() ?? <span className="text-gray-400">—</span>,
      }),
      columnHelper.accessor((p) => p.keyDates.target_go_live ?? null, {
        id: 'target_go_live',
        header: 'Target Go-Live',
        cell: (ctx) => ctx.getValue() ?? <span className="text-gray-400">—</span>,
        sortingFn: (a, b) => {
          const av = a.original.keyDates.target_go_live ?? '';
          const bv = b.original.keyDates.target_go_live ?? '';
          return av.localeCompare(bv);
        },
      }),
      columnHelper.display({
        id: 'tracker',
        header: 'Tracker',
        cell: (ctx) =>
          ctx.row.original.trackerRef ? (
            <span className="badge bg-indigo-50 text-indigo-700">
              {ctx.row.original.trackerRef.provider}
            </span>
          ) : null,
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: projects,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="page-stack">
      <div className="page-header">
        <div className="page-header-title">
          <span className="overline">Delivery Portfolio</span>
          <h1>Projects</h1>
          <div className="page-sub">{projects.length} active projects</div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi accent">
          <div className="kpi-label">Active</div>
          <div className="kpi-value">{projects.length}</div>
          <div className="kpi-sub">current portfolio</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">On track</div>
          <div className="kpi-value kpi-success">{onTrack}</div>
          <div className="kpi-sub">state OnTrack</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">At risk</div>
          <div className="kpi-value kpi-warning">{atRisk}</div>
          <div className="kpi-sub">state AtRisk</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Blocked</div>
          <div className="kpi-value kpi-danger">{blocked}</div>
          <div className="kpi-sub">state Blocked</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Go-Live ≤ 60d</div>
          <div className="kpi-value">{goingLiveSoon}</div>
          <div className="kpi-sub">Target Go-Live window</div>
        </div>
      </div>

      <div className="filter-row">
        <div className="filter-fields">
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">Phase</label>
            <select
              className="input"
              value={filters.phase}
              onChange={(e) =>
                setFilters((f) => ({ ...f, phase: e.target.value as Phase | '' }))
              }
            >
              <option value="">All</option>
              {PHASES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">State</label>
            <select
              className="input"
              value={filters.state}
              onChange={(e) =>
                setFilters((f) => ({ ...f, state: e.target.value as ProjectState | '' }))
              }
            >
              <option value="">All</option>
              {PROJECT_STATES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-600 mb-1">Owner</label>
            <input
              className="input"
              placeholder="Person id"
              value={filters.owner}
              onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))}
            />
          </div>
        </div>
        {isPM && (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            New project
          </button>
        )}
      </div>

      <div className="card">
        {query.isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading projects...</div>
        ) : query.isError ? (
          <div className="p-8 text-center text-red-700">
            Unable to load projects: {(query.error as Error).message}
          </div>
        ) : (query.data?.length ?? 0) === 0 ? (
          <EmptyState onCreate={isPM ? () => setCreateOpen(true) : undefined} />
        ) : (
          <table className="tbl">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th key={header.id} onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <span className="ml-1 text-gray-400" aria-hidden="true">
                        {{ asc: '▲', desc: '▼' }[header.column.getIsSorted() as string] ?? ''}
                      </span>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="empty">
      <div className="text-base text-gray-700 mb-2">No projects yet</div>
      <div className="text-sm text-gray-500 mb-4">
        Import from a tracker or create one manually.
      </div>
      {onCreate && (
        <button type="button" className="btn-primary" onClick={onCreate}>
          Create project
        </button>
      )}
    </div>
  );
}

function CreateProjectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<Phase>('Discovery');
  const [state, setState] = useState<ProjectState>('OnTrack');
  const [kickoff, setKickoff] = useState('');
  const [targetGoLive, setTargetGoLive] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const keyDates: Record<string, string> = {};
      if (kickoff) keyDates.kickoff = kickoff;
      if (targetGoLive) keyDates.target_go_live = targetGoLive;
      return endpoints.createProject({
        name,
        phase,
        state,
        ...(Object.keys(keyDates).length ? { keyDates } : {}),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      reset();
      onClose();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Unable to create project.'),
  });

  function reset() {
    setName('');
    setPhase('Discovery');
    setState('OnTrack');
    setKickoff('');
    setTargetGoLive('');
    setErr(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal open={open} title="Create project" onClose={handleClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          mutation.mutate();
        }}
      >
        <Field label="Name">
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phase">
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
          </Field>
          <Field label="State">
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
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kickoff">
            <input
              type="date"
              className="input w-full"
              value={kickoff}
              onChange={(e) => setKickoff(e.target.value)}
            />
          </Field>
          <Field label="Target Go-Live">
            <input
              type="date"
              className="input w-full"
              value={targetGoLive}
              onChange={(e) => setTargetGoLive(e.target.value)}
            />
          </Field>
        </div>
        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-2">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-600 block mb-1">{label}</span>
      {children}
    </label>
  );
}
