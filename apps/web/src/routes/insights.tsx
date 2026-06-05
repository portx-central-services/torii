import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { endpoints, type InsightsOverview } from '../api/endpoints.js';
import { InsightsChat } from '../components/InsightsChat.js';

type ProjectRow = InsightsOverview['projects'][number];
type PersonRow = InsightsOverview['people'][number];

const PROJECT_COLUMNS = [
  { key: 'projectName', label: 'Project' },
  { key: 'customerName', label: 'Customer' },
  { key: 'projectType', label: 'Type' },
  { key: 'phase', label: 'Phase' },
  { key: 'state', label: 'State' },
  { key: 'latestRagLevel', label: 'RAG' },
  { key: 'weeksStuckAtLevel', label: 'Weeks stuck' },
  { key: 'daysInCurrentPhase', label: 'Days in phase' },
  { key: 'budgetHours', label: 'Budget' },
  { key: 'spentHours', label: 'Spent' },
  { key: 'pctOfBudget', label: '% budget' },
  { key: 'slipDays', label: 'Slip' },
  { key: 'last30DaysHours', label: '30d hrs' },
] as const;

const PEOPLE_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'role', label: 'Role' },
  { key: 'committedPct', label: 'Committed %' },
  { key: 'availabilityPct', label: 'Available %' },
  { key: 'defaultCapacityPct', label: 'Default %' },
  { key: 'last7DaysHours', label: '7d hrs' },
  { key: 'last30DaysHours', label: '30d hrs' },
  { key: 'activeProjectCount', label: 'Projects' },
  { key: 'overCommittedBy', label: 'Over %' },
] as const;

type ProjectSortKey = (typeof PROJECT_COLUMNS)[number]['key'];
type PeopleSortKey = (typeof PEOPLE_COLUMNS)[number]['key'];
type SortDir = 'asc' | 'desc';

export function InsightsPage() {
  const query = useQuery({
    queryKey: ['insights-overview'],
    queryFn: () => endpoints.getInsightsOverview(),
  });

  return (
    <div className="insights-page">
      <div className="insights-metrics">
        <div className="page-header">
          <div className="page-header-title">
            <span className="overline">Portfolio</span>
            <h1>Insights</h1>
            <div className="page-sub">
              Aggregate metrics across projects, customers, and people. Ask the chat for
              cross-cutting answers.
            </div>
          </div>
        </div>

        {query.isLoading && <div className="text-gray-500">Loading metrics…</div>}
        {query.isError && (
          <div className="text-red-700">
            Unable to load insights: {(query.error as Error).message}
          </div>
        )}
        {query.data && <InsightsMetrics data={query.data} />}
      </div>

      <InsightsChat />
    </div>
  );
}

function InsightsMetrics({ data }: { data: InsightsOverview }) {
  return (
    <>
      <KpiRow kpis={data.kpis} />
      <ProjectsSection rows={data.projects} />
      <PeopleSection rows={data.people} />
      <TrendsSection trends={data.trends} />
    </>
  );
}

// ---- KPIs -----------------------------------------------------------------

function KpiRow({ kpis }: { kpis: InsightsOverview['kpis'] }) {
  return (
    <div className="kpi-row">
      <Kpi label="Active projects" value={kpis.activeProjects} sub="state ≠ Done" />
      <Kpi label="At risk" value={kpis.atRisk} sub="latest RAG ≠ Green" valueClass="kpi-warning" />
      <Kpi
        label="Recovered this week"
        value={kpis.recoveredThisWeek}
        sub="now Green, prev non-Green"
        valueClass="kpi-good"
      />
      <Kpi label="Over budget" value={kpis.overBudget} sub="spent > budget" valueClass="kpi-danger" />
      <Kpi label="Launching ≤ 30d" value={kpis.launchingSoon} sub="target go-live window" />
      <Kpi label="Hours 7d" value={kpis.hours7d.toFixed(1)} sub="org-wide" />
      <Kpi label="Hours 30d" value={kpis.hours30d.toFixed(1)} sub="org-wide" />
      <Kpi label="Active customers" value={kpis.activeCustomers} sub="≥1 active project" />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: number | string;
  sub: string;
  valueClass?: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass ?? ''}`}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

// ---- Projects table -------------------------------------------------------

function ProjectsSection({ rows }: { rows: ProjectRow[] }) {
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<ProjectSortKey>('projectName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (r) =>
        r.projectName.toLowerCase().includes(f) ||
        (r.customerName ?? '').toLowerCase().includes(f),
    );
  }, [rows, filter]);

  const sorted = useMemo(
    () => [...filtered].sort(buildComparator<ProjectRow>(sortKey, sortDir)),
    [filtered, sortKey, sortDir],
  );

  const onHeader = (key: ProjectSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <section className="insights-section">
      <header className="insights-section-head">
        <h2>Per-project metrics</h2>
        <input
          className="insights-filter"
          type="search"
          placeholder="Filter by project or customer…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </header>
      <div className="insights-table-wrap">
        <table className="insights-table">
          <thead>
            <tr>
              {PROJECT_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onHeader(c.key)}
                  className={`insights-sort ${sortKey === c.key ? `sorted-${sortDir}` : ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.projectId}>
                <td>
                  <Link to={`/projects/${r.projectId}`}>{r.projectName}</Link>
                </td>
                <td>
                  {r.customerId && r.customerName ? (
                    <Link to={`/customers/${r.customerId}`}>{r.customerName}</Link>
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </td>
                <td>
                  <span className={`insights-type-chip insights-type-${r.projectType}`}>
                    {r.projectType}
                  </span>
                </td>
                <td>{r.phase}</td>
                <td>{r.state}</td>
                <td>{r.latestRagLevel ? <RagBadge level={r.latestRagLevel} /> : '—'}</td>
                <td className="insights-num">{r.weeksStuckAtLevel || ''}</td>
                <td className="insights-num">{r.daysInCurrentPhase ?? '—'}</td>
                <td className="insights-num">{r.budgetHours ?? '—'}</td>
                <td className="insights-num">{r.spentHours ?? '—'}</td>
                <td className="insights-num">
                  {r.pctOfBudget === null ? '—' : `${r.pctOfBudget}%`}
                </td>
                <td className="insights-num">{r.slipDays ?? '—'}</td>
                <td className="insights-num">{r.last30DaysHours.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- People table ---------------------------------------------------------

function PeopleSection({ rows }: { rows: PersonRow[] }) {
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState<PeopleSortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(f));
  }, [rows, filter]);

  const sorted = useMemo(
    () => [...filtered].sort(buildComparator<PersonRow>(sortKey, sortDir)),
    [filtered, sortKey, sortDir],
  );

  const onHeader = (key: PeopleSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return (
    <section className="insights-section">
      <header className="insights-section-head">
        <h2>Per-person metrics</h2>
        <input
          className="insights-filter"
          type="search"
          placeholder="Filter by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </header>
      <div className="insights-table-wrap">
        <table className="insights-table">
          <thead>
            <tr>
              {PEOPLE_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onHeader(c.key)}
                  className={`insights-sort ${sortKey === c.key ? `sorted-${sortDir}` : ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.personId}>
                <td>
                  <Link to={`/people/${r.personId}`}>{r.name}</Link>
                </td>
                <td>{r.role}</td>
                <td className="insights-num">{r.committedPct}%</td>
                <td className="insights-num">{r.availabilityPct}%</td>
                <td className="insights-num">{r.defaultCapacityPct}%</td>
                <td className="insights-num">
                  {r.last7DaysHours === null ? '—' : r.last7DaysHours.toFixed(1)}
                </td>
                <td className="insights-num">
                  {r.last30DaysHours === null ? '—' : r.last30DaysHours.toFixed(1)}
                </td>
                <td className="insights-num">{r.activeProjectCount}</td>
                <td className="insights-num">
                  {r.overCommittedBy > 0 ? (
                    <span className="insights-overcommit-chip">+{r.overCommittedBy}%</span>
                  ) : (
                    ''
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- Trend charts ---------------------------------------------------------

function TrendsSection({ trends }: { trends: InsightsOverview['trends'] }) {
  const maxHours = Math.max(1, ...trends.weeklyHours.map((w) => w.hours));
  // RAG bar normalizes to the max total across weeks so segments stay comparable.
  const maxRag = Math.max(
    1,
    ...trends.weeklyRag.map((w) => w.red + w.amber + w.green),
  );

  return (
    <section className="insights-section">
      <header className="insights-section-head">
        <h2>Trends (last 8 weeks)</h2>
      </header>
      <div className="insights-trend-row">
        <div className="insights-trend-card">
          <div className="insights-trend-title">Hours billed per week</div>
          <div className="insights-trend-bars">
            {trends.weeklyHours.map((w) => (
              <div
                key={w.weekOf}
                className="insights-trend-bar-col"
                title={`${w.weekOf}: ${w.hours.toFixed(1)} hrs`}
              >
                <div
                  className="insights-trend-bar"
                  style={{ height: `${(w.hours / maxHours) * 100}%` }}
                />
                <div className="insights-trend-label">{w.weekOf.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="insights-trend-card">
          <div className="insights-trend-title">RAG distribution per week</div>
          <div className="insights-trend-bars">
            {trends.weeklyRag.map((w) => {
              const total = w.red + w.amber + w.green;
              const heightPct = (total / maxRag) * 100;
              const sum = total || 1;
              return (
                <div
                  key={w.weekOf}
                  className="insights-trend-bar-col"
                  title={`${w.weekOf}: R${w.red} A${w.amber} G${w.green}`}
                >
                  <div
                    className="insights-trend-stack"
                    style={{ height: `${heightPct}%` }}
                  >
                    {w.red > 0 && (
                      <div
                        className="dashboard-stacked-bar-red"
                        style={{ height: `${(w.red / sum) * 100}%` }}
                      />
                    )}
                    {w.amber > 0 && (
                      <div
                        className="dashboard-stacked-bar-amber"
                        style={{ height: `${(w.amber / sum) * 100}%` }}
                      />
                    )}
                    {w.green > 0 && (
                      <div
                        className="dashboard-stacked-bar-green"
                        style={{ height: `${(w.green / sum) * 100}%` }}
                      />
                    )}
                  </div>
                  <div className="insights-trend-label">{w.weekOf.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Helpers --------------------------------------------------------------

function RagBadge({ level }: { level: 'Red' | 'Amber' | 'Green' }) {
  return <span className={`rag-${level.toLowerCase()}`}>{level}</span>;
}

/**
 * Generic ascending-then-flipped comparator for table sort. Nulls/undefineds
 * sort last regardless of direction so empty cells don't disrupt the head of
 * the list when a user clicks a column header.
 */
function buildComparator<T>(key: keyof T, dir: 'asc' | 'desc') {
  const mult = dir === 'asc' ? 1 : -1;
  return (a: T, b: T) => {
    const av = a[key];
    const bv = b[key];
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
    return String(av).localeCompare(String(bv)) * mult;
  };
}
