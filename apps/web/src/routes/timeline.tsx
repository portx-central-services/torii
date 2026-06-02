import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  PHASES,
  PROJECT_STATES,
  phaseLabel,
  type Phase,
  type ProjectState,
} from '@torii/shared';
import {
  endpoints,
  PROJECT_TYPES,
  type Person,
  type Project,
  type ProjectType,
  type RagLevel,
  type RiskListItem,
} from '../api/endpoints.js';

interface VisibleRange {
  from: Date;
  to: Date;
}

function parseDateUTC(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

interface ProjectBounds {
  /** Where the bar starts being drawn. Always inside `[range.from, range.to]`. */
  start: Date;
  /** Where the bar stops being drawn. Always inside `[range.from, range.to]`. */
  end: Date;
  /** True iff the project's real `project_start` exists AND lies before `range.from`. */
  clippedLeft: boolean;
  /** True iff the project's real `target_go_live` exists AND lies after `range.to`. */
  clippedRight: boolean;
}

/**
 * Bar bounds for a project, given the visible window.
 *
 * The bar runs from `keyDates.project_start` to `keyDates.target_go_live`. When either
 * date is absent we fall back to the corresponding edge of `range` so the bar still
 * renders — a fully-unscheduled (e.g., Backlog) project shows as a full-width row,
 * signaling that it has no committed schedule.
 *
 * `clippedLeft`/`clippedRight` mark the case where the real date exists but extends
 * beyond the visible window; the caller renders dashed edges to signal "off-screen."
 * When the date is simply missing, no dashed edge is drawn (it's "unknown," not
 * "extends beyond"). Always returns bounds — projects are never silently omitted.
 */
function projectBounds(project: Project, range: VisibleRange): ProjectBounds {
  const realStart = parseDateUTC(project.keyDates.project_start);
  const realEnd = parseDateUTC(project.keyDates.target_go_live);
  const clippedLeft = realStart !== null && realStart.getTime() < range.from.getTime();
  const clippedRight = realEnd !== null && realEnd.getTime() > range.to.getTime();
  let start = realStart ?? range.from;
  let end = realEnd ?? range.to;
  if (start.getTime() < range.from.getTime()) start = range.from;
  if (end.getTime() > range.to.getTime()) end = range.to;
  // Inverted bars (end < start) can happen if Monday data is corrupt — collapse to a
  // 1-week sliver at `start` so they remain visible and reviewable.
  if (end.getTime() < start.getTime()) {
    end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (end.getTime() > range.to.getTime()) end = range.to;
  }
  return { start, end, clippedLeft, clippedRight };
}

/** Generate month tick labels across the visible range. */
function monthTicks(range: VisibleRange): Array<{ label: string; pct: number }> {
  const ticks: Array<{ label: string; pct: number }> = [];
  const start = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), 1));
  for (
    let d = new Date(start);
    d.getTime() <= range.to.getTime();
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  ) {
    const pct = pctOf(d, range);
    if (pct < 0 || pct > 100) continue;
    const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    ticks.push({ label, pct });
  }
  return ticks;
}

function pctOf(d: Date, range: VisibleRange): number {
  const total = range.to.getTime() - range.from.getTime();
  if (total <= 0) return 0;
  return ((d.getTime() - range.from.getTime()) / total) * 100;
}

/**
 * Phase fill colors for the Gantt bar — matches the PortX delivery-timeline prototype's
 * 7-phase palette (slate → violet → magenta → cyan → green → amber → mint). Saturated
 * because the bar's color is the primary phase signal (no per-phase ticks anymore).
 */
export const PHASE_BG: Record<Phase, string> = {
  Backlog: '#5a6378',
  Initiation: '#7359FE',
  Design: '#B825D0',
  Development: '#00C9E4',
  UAT: '#02E4A0',
  GoLiveReadiness: '#FD9E11',
  Production: '#32FFC5',
};

/** Foreground (text) color picked for contrast against each phase fill. */
const PHASE_FG: Record<Phase, string> = {
  Backlog: '#ffffff',
  Initiation: '#ffffff',
  Design: '#ffffff',
  Development: '#000000',
  UAT: '#000000',
  GoLiveReadiness: '#000000',
  Production: '#000000',
};

const RAG_BG: Record<RagLevel, string> = {
  Red: '#e5484d',
  Amber: '#f5a524',
  Green: '#02b07c',
};

/**
 * Stage derivation. Torii doesn't yet carry a Monday "Status" column, so we
 * approximate the prototype's Active/Committed split from `phase`: Backlog
 * means "committed but not yet started"; anything past Backlog is "active."
 *
 * One known edge case: an Initiation-phase project whose Monday status is
 * still "Not Started" (D-037 Plains Commerce in the prototype data) reads as
 * Active here. Importing a status column later would tighten this.
 */
type Stage = 'Active' | 'Committed';
function deriveStage(project: Project): Stage {
  return project.phase === 'Backlog' ? 'Committed' : 'Active';
}

const ROLE_KEYS = ['project_manager', 'solution_architect', 'solution_consultant'] as const;
type RoleKey = (typeof ROLE_KEYS)[number];
const ROLE_LABELS: Record<RoleKey, string> = {
  project_manager: 'PM',
  solution_architect: 'SA',
  solution_consultant: 'SC',
};

/**
 * Per-(project, role) entries for the by-person view. Each entry prefers the
 * resolved Person row (with id + name); falls back to the legacy `details.*`
 * string when no Person is linked. String-fallback entries can't link to
 * `/people/:id` since there's no Person row to point at.
 */
interface RoleEntry {
  /** Stable group key — Person.id when available, else the lowercased string. */
  key: string;
  /** Display name. */
  name: string;
  /** Person id when the entry came from a resolved Person, null on string fallback. */
  personId: string | null;
  role: RoleKey;
}
function projectRoleEntries(project: Project): RoleEntry[] {
  const out: RoleEntry[] = [];
  const sources: Array<{ role: RoleKey; person: Project['projectManager']; key: RoleKey }> = [
    { role: 'project_manager', person: project.projectManager, key: 'project_manager' },
    { role: 'solution_architect', person: project.solutionArchitect, key: 'solution_architect' },
    { role: 'solution_consultant', person: project.solutionConsultant, key: 'solution_consultant' },
  ];
  for (const s of sources) {
    if (s.person) {
      out.push({ key: s.person.id, name: s.person.name, personId: s.person.id, role: s.role });
    } else {
      const fallback = project.details?.[s.key]?.trim();
      if (fallback) {
        out.push({ key: `str:${fallback.toLowerCase()}`, name: fallback, personId: null, role: s.role });
      }
    }
  }
  return out;
}

interface Filters {
  fromMonths: number; // negative offset from today (months)
  toMonths: number; // positive offset from today (months)
  projectType: 'both' | ProjectType;
  stage: 'all' | Stage;
  states: Set<ProjectState>;
  phases: Set<Phase>;
  /** Selected person's name, or '' for "all people". */
  person: string;
  /** When set, the person filter only matches projects where they hold this role. */
  role: '' | RoleKey;
  view: 'project' | 'person';
  /**
   * When true, each project bar with a Harvest snapshot renders a translucent
   * budget-fill overlay (spent/budget); bars over 100% render an additional
   * diagonal-stripe overflow tail. Off by default.
   */
  showBudget: boolean;
}

const DEFAULT_FILTERS: Filters = {
  fromMonths: -2,
  toMonths: 4,
  projectType: 'both',
  stage: 'all',
  states: new Set(),
  phases: new Set(),
  person: '',
  role: '',
  view: 'project',
  showBudget: false,
};

function monthsFromToday(months: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
}

export function TimelinePage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const range: VisibleRange = useMemo(
    () => ({ from: monthsFromToday(filters.fromMonths), to: monthsFromToday(filters.toMonths + 1) }),
    [filters.fromMonths, filters.toMonths],
  );

  const projectsQ = useQuery({
    queryKey: ['projects', 'timeline'],
    queryFn: () => endpoints.listProjects({}),
  });
  const risksQ = useQuery({
    queryKey: ['risks'],
    queryFn: () => endpoints.listRisks(),
  });

  const riskByProject = useMemo(() => {
    const map = new Map<string, RiskListItem>();
    for (const r of risksQ.data ?? []) map.set(r.projectId, r);
    return map;
  }, [risksQ.data]);

  const today = useMemo(() => new Date(), []);
  const todayPct = useMemo(() => {
    const pct = pctOf(today, range);
    return pct >= 0 && pct <= 100 ? pct : null;
  }, [today, range]);

  const allProjects = projectsQ.data ?? [];
  // Person dropdown is driven by the canonical Person table now, not by walking
  // the string `details.*` values. Each option's value is the Person.id; the
  // filter then compares against `project.projectManagerId` / `solutionArchitectId`
  // / `solutionConsultantId` / `ownerId` (all FK columns).
  const peopleQ = useQuery({
    queryKey: ['people', 'timeline'],
    queryFn: () => endpoints.listPeople(),
  });
  const peopleOptions = useMemo(() => {
    const list = peopleQ.data ?? [];
    return list.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [peopleQ.data]);

  const visibleProjects = useMemo(() => {
    return allProjects
      .map((p) => ({ p, bounds: projectBounds(p, range) }))
      .filter(({ p }) => {
        // Date-window overlap: a project with a real `project_start` after the window
        // OR a real `target_go_live` before the window is off-screen. Projects with no
        // dates at all always render (their bar fills the window).
        const realStart = parseDateUTC(p.keyDates.project_start);
        const realEnd = parseDateUTC(p.keyDates.target_go_live);
        if (realStart && realStart.getTime() > range.to.getTime()) return false;
        if (realEnd && realEnd.getTime() < range.from.getTime()) return false;
        // Project type
        if (filters.projectType !== 'both' && p.projectType !== filters.projectType) return false;
        // Stage (Active vs Committed)
        if (filters.stage !== 'all' && deriveStage(p) !== filters.stage) return false;
        // State
        if (filters.states.size > 0 && !filters.states.has(p.state)) return false;
        // Phase
        if (filters.phases.size > 0 && !filters.phases.has(p.phase)) return false;
        // Person + role. With a role selected, the named person must hold that
        // specific role. With no role, they need only hold any of PM/SA/SC.
        // With only a role (no person), the project must have someone in that role.
        // Person filter compares against the joined Person's id (FK target), not
        // against free-form `details.*` strings. The dropdown's `value` is a Person.id.
        const personIdForRole = (key: RoleKey): string | null => {
          if (key === 'project_manager') return p.projectManager?.id ?? null;
          if (key === 'solution_architect') return p.solutionArchitect?.id ?? null;
          return p.solutionConsultant?.id ?? null;
        };
        if (filters.person && filters.role) {
          if (personIdForRole(filters.role) !== filters.person) return false;
        } else if (filters.person) {
          const anyMatch =
            p.projectManager?.id === filters.person ||
            p.solutionArchitect?.id === filters.person ||
            p.solutionConsultant?.id === filters.person ||
            p.ownerId === filters.person;
          if (!anyMatch) return false;
        } else if (filters.role) {
          if (!personIdForRole(filters.role)) return false;
        }
        return true;
      });
  }, [allProjects, range, filters]);

  /** Counts for the KPI strip — all driven off the same filtered set the chart uses. */
  const kpis = useMemo(() => {
    const projects = visibleProjects.map(({ p }) => p);
    const people = new Set<string>();
    for (const p of projects) {
      for (const k of ROLE_KEYS) {
        const v = p.details?.[k]?.trim();
        if (v) people.add(v);
      }
    }
    let active = 0;
    let dev = 0;
    let uatOrLaunch = 0;
    let backlogOrInit = 0;
    for (const p of projects) {
      if (deriveStage(p) === 'Active') active += 1;
      if (p.phase === 'Development') dev += 1;
      if (p.phase === 'UAT' || p.phase === 'GoLiveReadiness') uatOrLaunch += 1;
      if (p.phase === 'Backlog' || p.phase === 'Initiation') backlogOrInit += 1;
    }
    return {
      projects: projects.length,
      people: people.size,
      active,
      dev,
      uatOrLaunch,
      backlogOrInit,
    };
  }, [visibleProjects]);

  const ticks = useMemo(() => monthTicks(range), [range]);

  /**
   * Group filtered projects by person for the by-person view. Each group's key
   * is the Person.id when available, or `str:<name>` for string-fallback rows.
   * Sorted alphabetically by display name.
   */
  const byPerson = useMemo(() => {
    if (filters.view !== 'person') return null;
    interface Group {
      key: string;
      displayName: string;
      personId: string | null;
      rows: Array<{ p: Project; bounds: ProjectBounds; role: RoleKey }>;
    }
    const map = new Map<string, Group>();
    for (const { p, bounds } of visibleProjects) {
      for (const entry of projectRoleEntries(p)) {
        // When a person filter is set, only include resolved-Person entries
        // whose id matches. String-fallback entries can't satisfy a Person-id filter.
        if (filters.person && entry.personId !== filters.person) continue;
        if (filters.role && entry.role !== filters.role) continue;
        if (!map.has(entry.key)) {
          map.set(entry.key, {
            key: entry.key,
            displayName: entry.name,
            personId: entry.personId,
            rows: [],
          });
        }
        map.get(entry.key)!.rows.push({ p, bounds, role: entry.role });
      }
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        rows: g.rows.slice().sort((a, b) => a.bounds.start.getTime() - b.bounds.start.getTime()),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [visibleProjects, filters.view, filters.person, filters.role]);

  return (
    <div className="page-stack">
      <div className="page-header">
        <div className="page-header-title">
          <span className="overline">Portfolio</span>
          <h1>Timeline</h1>
          <div className="page-sub">
            Every project across time, colored by phase.
          </div>
        </div>
      </div>

      <KpiStrip kpis={kpis} />
      <TimelineFilters filters={filters} onChange={setFilters} peopleOptions={peopleOptions} />

      {projectsQ.isLoading ? (
        <div className="text-gray-500">Loading projects…</div>
      ) : visibleProjects.length === 0 ? (
        <div className="section-card empty">
          <div className="text-base text-gray-700 mb-2">No projects in this window</div>
          <div className="text-sm text-gray-500">Adjust your filters or widen the date range.</div>
        </div>
      ) : (
        <div className="timeline-chart section-card">
          <div className="timeline-axis">
            {ticks.map((t) => (
              <div key={t.label} className="timeline-tick" style={{ left: `${t.pct}%` }}>
                <span>{t.label}</span>
              </div>
            ))}
          </div>
          <div className="timeline-rows">
            {todayPct !== null && (
              <div
                className="timeline-today-line"
                style={{ left: `calc(232px + (100% - 232px) * ${todayPct / 100})` }}
                title={`Today: ${today.toISOString().slice(0, 10)}`}
              >
                <span className="timeline-today-label">TODAY</span>
              </div>
            )}
            {filters.view === 'project'
              ? visibleProjects.map(({ p, bounds }) => (
                  <BarRow
                    key={p.id}
                    project={p}
                    bounds={bounds}
                    range={range}
                    risk={riskByProject.get(p.id) ?? null}
                    label={p.name}
                    showBudget={filters.showBudget}
                    onClick={() => navigate(`/projects/${p.id}`)}
                  />
                ))
              : (byPerson ?? []).map((group) => (
                  <div key={group.key} className="timeline-person-group">
                    <div className="timeline-person-header">
                      <span className="timeline-person-name">
                        {group.personId ? (
                          <a href={`/people/${group.personId}`} className="text-torii hover:underline">
                            {group.displayName}
                          </a>
                        ) : (
                          group.displayName
                        )}
                      </span>
                      <span className="timeline-person-count">
                        {group.rows.length} project{group.rows.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {group.rows.map(({ p, bounds, role }) => (
                      <BarRow
                        key={`${group.key}:${role}:${p.id}`}
                        project={p}
                        bounds={bounds}
                        range={range}
                        risk={riskByProject.get(p.id) ?? null}
                        label={p.name}
                        roleBadge={ROLE_LABELS[role]}
                        showBudget={filters.showBudget}
                        onClick={() => navigate(`/projects/${p.id}`)}
                      />
                    ))}
                  </div>
                ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BarRow({
  project,
  bounds,
  range,
  risk,
  label,
  roleBadge,
  showBudget,
  onClick,
}: {
  project: Project;
  bounds: ProjectBounds;
  range: VisibleRange;
  risk: RiskListItem | null;
  label: string;
  roleBadge?: string;
  showBudget: boolean;
  onClick: () => void;
}) {
  const leftPct = Math.max(0, pctOf(bounds.start, range));
  const rightPct = Math.min(100, pctOf(bounds.end, range));
  const widthPct = Math.max(0.5, rightPct - leftPct);
  const isOverBudget = project.overBudget === true;
  const startLabel = project.keyDates.project_start ?? '—';
  const endLabel = project.keyDates.target_go_live ?? '—';
  const barClass = [
    'timeline-bar',
    bounds.clippedLeft ? 'timeline-bar-clipped-left' : '',
    bounds.clippedRight ? 'timeline-bar-clipped-right' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Budget-fill geometry, only when the toggle is on AND the project has a snapshot
  // with a positive budget. Projects without a Harvest link or without a budget
  // render the bar normally (no fill, no overflow stripes).
  const hasBudgetData =
    showBudget &&
    project.budgetHours !== null &&
    project.budgetHours > 0 &&
    project.spentHours !== null;
  const budgetFillPct = hasBudgetData
    ? Math.min(100, (project.spentHours! / project.budgetHours!) * 100)
    : 0;
  const showOverflow = hasBudgetData && project.spentHours! > project.budgetHours!;

  return (
    <button
      type="button"
      className="timeline-row"
      onClick={onClick}
      title={`${project.name} — ${startLabel} → ${endLabel}`}
    >
      <span className="timeline-row-label">
        {roleBadge && <span className="timeline-role-badge">{roleBadge}</span>}
        <span className="timeline-row-label-text">{label}</span>
      </span>
      <span className="timeline-row-track">
        <span
          className={barClass}
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            background: PHASE_BG[project.phase],
            color: PHASE_FG[project.phase],
          }}
        >
          {hasBudgetData && (
            <>
              <span
                className="timeline-bar-budget-fill"
                style={{ width: `${budgetFillPct}%` }}
              />
              {showOverflow && <span className="timeline-bar-budget-overflow" />}
            </>
          )}
          <span className="timeline-bar-phase">{phaseLabel(project.phase)}</span>
          {risk && (
            <span
              className="timeline-bar-risk"
              style={{ background: RAG_BG[risk.ragLevel] }}
              title={`At risk: ${risk.ragLevel}`}
            />
          )}
          {isOverBudget && (
            <span className="timeline-bar-budget" title="Over budget">
              $
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

function KpiStrip({ kpis }: { kpis: { projects: number; people: number; active: number; dev: number; uatOrLaunch: number; backlogOrInit: number } }) {
  return (
    <div className="timeline-kpis section-card">
      <Kpi label="Projects (filtered)" value={kpis.projects} accent />
      <Kpi label="People involved" value={kpis.people} />
      <Kpi label="Active" value={kpis.active} />
      <Kpi label="In UAT / Go-Live" value={kpis.uatOrLaunch} />
      <Kpi label="In Development" value={kpis.dev} />
      <Kpi label="In Backlog / Init" value={kpis.backlogOrInit} />
    </div>
  );
}

function Kpi({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`timeline-kpi${accent ? ' timeline-kpi-accent' : ''}`}>
      <div className="timeline-kpi-label">{label}</div>
      <div className="timeline-kpi-value">{value}</div>
    </div>
  );
}

function TimelineFilters({
  filters,
  onChange,
  peopleOptions,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  peopleOptions: readonly Person[];
}) {
  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  return (
    <div className="filter-row">
      <div className="filter-fields">
        <div className="field-wrap">
          <label className="field-label">View</label>
          <div className="segmented">
            <button
              type="button"
              className={filters.view === 'project' ? 'on' : ''}
              onClick={() => onChange({ ...filters, view: 'project' })}
            >
              By project
            </button>
            <button
              type="button"
              className={filters.view === 'person' ? 'on' : ''}
              onClick={() => onChange({ ...filters, view: 'person' })}
            >
              By person
            </button>
          </div>
        </div>
        <div className="field-wrap">
          <label className="field-label">Show budget</label>
          <div className="segmented">
            <button
              type="button"
              className={!filters.showBudget ? 'on' : ''}
              onClick={() => onChange({ ...filters, showBudget: false })}
            >
              Off
            </button>
            <button
              type="button"
              className={filters.showBudget ? 'on' : ''}
              onClick={() => onChange({ ...filters, showBudget: true })}
            >
              On
            </button>
          </div>
        </div>
        <div className="field-wrap">
          <label className="field-label">From (months ago)</label>
          <input
            type="number"
            className="input"
            style={{ width: 90 }}
            value={Math.abs(filters.fromMonths)}
            onChange={(e) =>
              onChange({ ...filters, fromMonths: -Math.max(0, Number(e.target.value || 0)) })
            }
          />
        </div>
        <div className="field-wrap">
          <label className="field-label">To (months ahead)</label>
          <input
            type="number"
            className="input"
            style={{ width: 90 }}
            value={filters.toMonths}
            onChange={(e) => onChange({ ...filters, toMonths: Math.max(0, Number(e.target.value || 0)) })}
          />
        </div>
        <div className="field-wrap">
          <label className="field-label">Project type</label>
          <select
            className="input"
            value={filters.projectType}
            onChange={(e) => onChange({ ...filters, projectType: e.target.value as Filters['projectType'] })}
          >
            <option value="both">Both</option>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field-wrap">
          <label className="field-label">Stage</label>
          <select
            className="input"
            value={filters.stage}
            onChange={(e) => onChange({ ...filters, stage: e.target.value as Filters['stage'] })}
          >
            <option value="all">All</option>
            <option value="Active">Active</option>
            <option value="Committed">Committed</option>
          </select>
        </div>
        <div className="field-wrap">
          <label className="field-label">State</label>
          <div className="segmented">
            {PROJECT_STATES.map((s) => (
              <button
                key={s}
                type="button"
                className={filters.states.has(s) ? 'on' : ''}
                onClick={() => onChange({ ...filters, states: toggle(filters.states, s) })}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="field-wrap">
          <label className="field-label">Phase</label>
          <div className="segmented">
            {PHASES.map((ph) => (
              <button
                key={ph}
                type="button"
                className={filters.phases.has(ph) ? 'on' : ''}
                onClick={() => onChange({ ...filters, phases: toggle(filters.phases, ph) })}
              >
                {phaseLabel(ph)}
              </button>
            ))}
          </div>
        </div>
        <div className="field-wrap">
          <label className="field-label">Person</label>
          <select
            className="input"
            value={filters.person}
            onChange={(e) => onChange({ ...filters, person: e.target.value })}
          >
            <option value="">All people</option>
            {peopleOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field-wrap">
          <label className="field-label">Role</label>
          <select
            className="input"
            value={filters.role}
            onChange={(e) => onChange({ ...filters, role: e.target.value as Filters['role'] })}
          >
            <option value="">Any role</option>
            {ROLE_KEYS.map((k) => (
              <option key={k} value={k}>
                {ROLE_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => onChange(DEFAULT_FILTERS)}
      >
        Reset
      </button>
    </div>
  );
}
