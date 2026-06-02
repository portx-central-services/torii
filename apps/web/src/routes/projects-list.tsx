import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { PHASES, PROJECT_STATES, phaseLabel, type Phase, type ProjectState } from '@torii/shared';
import {
  endpoints,
  PROJECT_DETAIL_FIELDS,
  DEFAULT_HIDDEN_DETAIL_COLUMNS,
  type Project,
} from '../api/endpoints.js';
import { PhaseBadge, StateBadge } from '../components/Badge.js';
import { Modal } from '../components/Modal.js';
import { useIsPM } from '../auth/AuthProvider.js';
import { ApiError } from '../api/client.js';

interface Filters {
  phase: Phase | '';
  state: ProjectState | '';
  owner: string;
}

/**
 * Single-selected KPI tile filter. `null` = no tile filter active. The tiles compose
 * with the search input and the existing dropdown filters via AND.
 */
type TileFilter = null | 'active' | 'on-track' | 'at-risk' | 'blocked' | 'go-live-60d';

const columnHelper = createColumnHelper<Project>();

/** Test whether a project falls within the "Go-Live in the next 60 days" window. */
function isGoLiveSoon(p: Project, now: number, ms60d: number): boolean {
  const target = p.keyDates.target_go_live;
  if (!target) return false;
  const ts = new Date(target).getTime();
  return ts >= now && ts - now <= ms60d && p.state !== 'Done';
}

function matchesTile(p: Project, tile: TileFilter, now: number, ms60d: number): boolean {
  switch (tile) {
    case null:
      return true;
    case 'active':
      return (
        (p.state === 'OnTrack' || p.state === 'AtRisk' || p.state === 'Blocked') &&
        p.phase !== 'Backlog'
      );
    case 'on-track':
      return p.state === 'OnTrack';
    case 'at-risk':
      return p.state === 'AtRisk';
    case 'blocked':
      return p.state === 'Blocked';
    case 'go-live-60d':
      return isGoLiveSoon(p, now, ms60d);
  }
}

/** Build a case-insensitive haystack of every searchable property on a project. */
function searchHaystack(p: Project): string {
  const d = p.details ?? {};
  return [
    p.name,
    p.state,
    p.phase,
    p.ownerId ?? '',
    // Resolved Person names — searching by Person.name surfaces the project even
    // when the legacy `details.*` string is stale or formatted differently.
    p.projectManager?.name ?? '',
    p.solutionArchitect?.name ?? '',
    p.solutionConsultant?.name ?? '',
    // Legacy strings stay in the haystack as fallback (cheap; covers the edge
    // case where the FK is null but the string is set).
    d.project_manager ?? '',
    d.solution_architect ?? '',
    d.solution_consultant ?? '',
    d.core_solution ?? '',
    d.core_vendor ?? '',
    d.customer_type ?? '',
    d.customer_status ?? '',
    d.finance_use_case ?? '',
    d.use_case_group ?? '',
    d.primary_contact ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export function ProjectsListPage() {
  const isPM = useIsPM();
  const [filters, setFilters] = useState<Filters>({ phase: '', state: '', owner: '' });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [createOpen, setCreateOpen] = useState(false);
  const [tileFilter, setTileFilter] = useState<TileFilter>(null);
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['projects', filters],
    queryFn: () =>
      endpoints.listProjects({
        phase: filters.phase || undefined,
        state: filters.state || undefined,
        owner: filters.owner || undefined,
      }),
  });

  const queryClient = useQueryClient();
  const prefsQuery = useQuery({
    queryKey: ['preferences'],
    queryFn: () => endpoints.getPreferences(),
  });

  // Column visibility is seeded once from saved prefs. A user with no saved
  // hidden columns gets the default-hidden set; once they have any saved value
  // we honor it verbatim.
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !prefsQuery.data) return;
    const hidden =
      prefsQuery.data.hiddenProjectColumns.length > 0
        ? prefsQuery.data.hiddenProjectColumns
        : DEFAULT_HIDDEN_DETAIL_COLUMNS;
    const vis: VisibilityState = {};
    for (const field of PROJECT_DETAIL_FIELDS) vis[field.key] = !hidden.includes(field.key);
    setColumnVisibility(vis);
    seeded.current = true;
  }, [prefsQuery.data]);

  const savePrefs = useMutation({
    mutationFn: (hidden: string[]) => endpoints.updatePreferences(hidden),
    onSuccess: (data) => queryClient.setQueryData(['preferences'], data),
  });

  function toggleColumn(key: string) {
    setColumnVisibility((prev) => {
      const next = { ...prev, [key]: prev[key] === false ? true : false };
      const hidden = PROJECT_DETAIL_FIELDS.filter((f) => next[f.key] === false).map((f) => f.key);
      savePrefs.mutate(hidden);
      return next;
    });
  }

  const allProjects = query.data ?? [];

  // `Date.now()` returns a fresh value on every render — keep it OUT of memo deps,
  // otherwise the memo never memoizes and the filtered `projects` array gets a
  // fresh reference per keystroke. React Table then rebuilds its row model for
  // every keystroke, which made the page unresponsive at ~200 rows.
  const ms60d = 60 * 24 * 60 * 60 * 1000;

  // KPI counts reflect the whole fetched portfolio (already narrowed by the API-side
  // phase/state/owner filters), NOT the in-memory tile + search filters — the tiles
  // always show how many projects WOULD match if you clicked them. These run every
  // render (cheap; no memoization needed for a ~200-row count loop).
  const onTrack = allProjects.filter((p) => p.state === 'OnTrack').length;
  const atRisk = allProjects.filter((p) => p.state === 'AtRisk').length;
  const blocked = allProjects.filter((p) => p.state === 'Blocked').length;
  const goingLiveSoon = allProjects.filter((p) => isGoLiveSoon(p, Date.now(), ms60d)).length;

  // The list rendered in the table is filtered by tile + search, composed via AND
  // with the dropdown filters already applied at the API layer. `now` is computed
  // inside the callback so it isn't a dep — see comment above.
  const projects = useMemo(() => {
    const now = Date.now();
    const needle = search.trim().toLowerCase();
    return allProjects
      .filter((p) => matchesTile(p, tileFilter, now, ms60d))
      .filter((p) => (needle ? searchHaystack(p).includes(needle) : true));
  }, [allProjects, tileFilter, search, ms60d]);

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
      ...PROJECT_DETAIL_FIELDS.map((field) => {
        // For the three role fields, the column's "value" is the resolved Person
        // name (with link in the cell), falling back to the legacy `details.*` string
        // when no Person is linked. Other fields read directly from `details`.
        const personGetter = (p: Project) =>
          field.key === 'project_manager'
            ? p.projectManager
            : field.key === 'solution_architect'
              ? p.solutionArchitect
              : field.key === 'solution_consultant'
                ? p.solutionConsultant
                : null;
        return columnHelper.accessor(
          (p) => personGetter(p)?.name ?? p.details?.[field.key] ?? undefined,
          {
            id: field.key,
            header: field.label,
            sortUndefined: 'last',
            cell: (ctx) => {
              const person = personGetter(ctx.row.original);
              const value = ctx.getValue();
              if (!value) return <span className="text-gray-400">—</span>;
              if (person) {
                return (
                  <Link to={`/people/${person.id}`} className="text-torii hover:underline">
                    {person.name}
                  </Link>
                );
              }
              if ('isLink' in field && field.isLink) {
                return (
                  <a href={value} target="_blank" rel="noreferrer" className="text-torii hover:underline">
                    Open
                  </a>
                );
              }
              return value;
            },
          },
        );
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: projects,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="page-stack">
      <div className="page-header">
        <div className="page-header-title">
          <span className="overline">Delivery Portfolio</span>
          <h1>Projects</h1>
          <div className="page-sub">
            {projects.length === allProjects.length
              ? `${allProjects.length} projects`
              : `${projects.length} of ${allProjects.length} projects shown`}
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <TileButton
          label="Active"
          value={allProjects.filter((p) => matchesTile(p, 'active', Date.now(), ms60d)).length}
          sub="state ≠ Done, phase ≠ Backlog"
          active={tileFilter === 'active'}
          onClick={() => setTileFilter((t) => (t === 'active' ? null : 'active'))}
          accent
        />
        <TileButton
          label="On track"
          value={onTrack}
          sub="state OnTrack"
          active={tileFilter === 'on-track'}
          onClick={() => setTileFilter((t) => (t === 'on-track' ? null : 'on-track'))}
          valueClass="kpi-success"
        />
        <TileButton
          label="At risk"
          value={atRisk}
          sub="state AtRisk"
          active={tileFilter === 'at-risk'}
          onClick={() => setTileFilter((t) => (t === 'at-risk' ? null : 'at-risk'))}
          valueClass="kpi-warning"
        />
        <TileButton
          label="Blocked"
          value={blocked}
          sub="state Blocked"
          active={tileFilter === 'blocked'}
          onClick={() => setTileFilter((t) => (t === 'blocked' ? null : 'blocked'))}
          valueClass="kpi-danger"
        />
        <TileButton
          label="Go-Live ≤ 60d"
          value={goingLiveSoon}
          sub="Target Go-Live window"
          active={tileFilter === 'go-live-60d'}
          onClick={() => setTileFilter((t) => (t === 'go-live-60d' ? null : 'go-live-60d'))}
        />
      </div>

      <div className="filter-row" style={{ marginBottom: 0 }}>
        <div className="field-wrap" style={{ flex: 1 }}>
          <label className="field-label">Search</label>
          <input
            type="text"
            className="input"
            placeholder="Search projects, people, cores, customers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="text-xs text-gray-600" style={{ alignSelf: 'flex-end', paddingBottom: 10 }}>
          {projects.length} of {allProjects.length} match
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
                  {phaseLabel(p)}
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
        <div className="flex items-end gap-2">
          <ColumnsMenu visibility={columnVisibility} onToggle={toggleColumn} />
          {isPM && (
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              New project
            </button>
          )}
        </div>
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
          <div style={{ overflowX: 'auto' }}>
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
          </div>
        )}
      </div>

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function ColumnsMenu({
  visibility,
  onToggle,
}: {
  visibility: VisibilityState;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="btn-secondary" onClick={() => setOpen((v) => !v)}>
        Columns
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-20 mt-1 w-56 rounded border border-gray-200 bg-white p-2 shadow-lg"
            style={{ maxHeight: 320, overflowY: 'auto' }}
          >
            <div className="px-1 pb-1 text-xs font-medium text-gray-500">Detail columns</div>
            {PROJECT_DETAIL_FIELDS.map((field) => (
              <label
                key={field.key}
                className="flex items-center gap-2 px-1 py-1 text-sm hover:bg-gray-50 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={visibility[field.key] !== false}
                  onChange={() => onToggle(field.key)}
                />
                {field.label}
              </label>
            ))}
          </div>
        </>
      )}
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
  const [phase, setPhase] = useState<Phase>('Backlog');
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
    setPhase('Backlog');
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
                  {phaseLabel(p)}
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

/**
 * Clickable KPI tile that toggles a single-selected filter on the projects list.
 * Visually identical to the prior static tile when inactive; gets a `kpi-active`
 * class when this tile is the active filter.
 */
function TileButton({
  label,
  value,
  sub,
  active,
  onClick,
  accent,
  valueClass,
}: {
  label: string;
  value: number;
  sub: string;
  active: boolean;
  onClick: () => void;
  accent?: boolean;
  valueClass?: string;
}) {
  const className = [
    'kpi',
    accent ? 'accent' : '',
    active ? 'kpi-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-pressed={active}
      style={{
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass ?? ''}`}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </button>
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
