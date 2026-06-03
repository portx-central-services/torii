import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { endpoints, type PeopleOverviewRow } from '../api/endpoints.js';

type SortKey =
  | 'name'
  | 'role'
  | 'capacity'
  | 'availability'
  | 'billed30d'
  | 'projects'
  | 'lastReported';
type SortDir = 'asc' | 'desc';

export function PeopleListPage() {
  const overview = useQuery({
    queryKey: ['people-overview'],
    queryFn: () => endpoints.getPeopleOverview(),
  });

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const data = (overview.data ?? []).slice();
    data.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const cmp = compareSortable(va, vb);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return data;
  }, [overview.data, sortKey, sortDir]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function header(key: SortKey, label: string, align: 'left' | 'right' = 'left') {
    const active = sortKey === key;
    return (
      <th
        style={{ textAlign: align, padding: '8px 8px', cursor: 'pointer' }}
        onClick={() => {
          if (active) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          else {
            setSortKey(key);
            setSortDir('asc');
          }
        }}
      >
        {label}
        {active && <span style={{ marginLeft: 6 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </th>
    );
  }

  return (
    <div className="page-stack">
      <PeopleHeader />
      {overview.isLoading ? (
        <div className="text-gray-500">Loading…</div>
      ) : overview.isError ? (
        <div className="text-red-700">
          Unable to load people: {(overview.error as Error).message}
        </div>
      ) : rows.length === 0 ? (
        <div className="dashboard-empty">No people yet.</div>
      ) : (
        <section className="section-card">
          <table className="people-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ink-200)' }}>
                {header('name', 'Name')}
                {header('role', 'Role')}
                {header('capacity', 'Capacity')}
                {header('availability', 'Available', 'right')}
                {header('billed30d', '30d billed', 'right')}
                {header('projects', 'Active projects')}
                {header('lastReported', 'Last reported')}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PersonRow
                  key={row.id}
                  row={row}
                  expanded={expanded.has(row.id)}
                  onToggle={() => toggleExpand(row.id)}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function PeopleHeader() {
  return (
    <div className="page-header">
      <div className="page-header-title">
        <span className="overline">Team</span>
        <h1>People</h1>
        <div className="page-sub">
          Roster, workload, and recent billing across the team.
        </div>
      </div>
    </div>
  );
}

function PersonRow({
  row,
  expanded,
  onToggle,
}: {
  row: PeopleOverviewRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const overBy = row.committedPct + row.availabilityPct - row.defaultCapacityPct;
  const harvestLinked = row.harvestUserId !== null;
  const billedTooltip =
    row.billedHoursAsOf === null
      ? undefined
      : `Updated ${relativeTime(new Date(row.billedHoursAsOf))}`;

  return (
    <>
      <tr style={{ borderBottom: expanded ? 'none' : '1px solid var(--ink-100)' }}>
        <td style={{ padding: '8px 8px' }}>
          <Link to={`/people/${row.id}`} className="text-torii hover:underline">
            {row.name}
          </Link>
        </td>
        <td style={{ padding: '8px 8px' }}>
          <span className={`role-chip role-${row.role.toLowerCase()}`}>{row.role}</span>
          {row.isAdmin && <span className="role-admin"> ★ Admin</span>}
          {!harvestLinked && <span className="role-unlinked">Harvest</span>}
        </td>
        <td style={{ padding: '8px 8px' }}>
          <span className="people-capacity-text">
            {row.committedPct}% committed of {row.defaultCapacityPct}%
          </span>
          {overBy > 0 && (
            <span className="people-overcommit-chip">Over by {overBy}%</span>
          )}
        </td>
        <td style={{ padding: '8px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {row.availabilityPct}%
        </td>
        <td
          style={{ padding: '8px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
          title={billedTooltip}
        >
          {row.billedHoursLast30d === null
            ? <span className="dashboard-em">—</span>
            : `${row.billedHoursLast30d.toLocaleString('en-US', { maximumFractionDigits: 1 })}h`}
        </td>
        <td style={{ padding: '8px 8px' }}>
          <button
            type="button"
            className="people-expand-btn"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.name}'s projects`}
          >
            <span className={`people-expand-chevron${expanded ? ' open' : ''}`}>▶</span>
            <span>{row.currentProjects.length}</span>
          </button>
        </td>
        <td style={{ padding: '8px 8px', color: 'var(--ink-500)' }}>
          {row.lastReportedAt === null
            ? <span className="dashboard-em">—</span>
            : relativeTime(new Date(row.lastReportedAt))}
        </td>
      </tr>
      {expanded && (
        <tr className="people-table-expanded">
          <td colSpan={7} style={{ padding: '0 8px 12px 32px' }}>
            <ExpandedProjects row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

function ExpandedProjects({ row }: { row: PeopleOverviewRow }) {
  if (row.currentProjects.length === 0) {
    return <div className="empty">No current projects.</div>;
  }

  // Group projects under customer headers. Unmapped projects (customerId === null)
  // land in a trailing "No customer" group so named customers come first.
  const groups: Array<{
    customerId: string | null;
    customerName: string | null;
    projects: PeopleOverviewRow['currentProjects'];
  }> = [];
  const indexByKey = new Map<string, number>();
  for (const p of row.currentProjects) {
    const key = p.customerId ?? '__none__';
    const idx = indexByKey.get(key);
    if (idx === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        customerId: p.customerId,
        customerName: p.customerName,
        projects: [p],
      });
    } else {
      groups[idx]!.projects.push(p);
    }
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ color: 'var(--ink-500)', textAlign: 'left' }}>
          <th style={{ padding: '6px 4px' }}>Project</th>
          <th style={{ padding: '6px 4px', textAlign: 'right' }}>Current</th>
          <th style={{ padding: '6px 4px', textAlign: 'right' }}>Planned</th>
          <th style={{ padding: '6px 4px', textAlign: 'right' }}>Lifetime</th>
          <th style={{ padding: '6px 4px' }}>Variance</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <CustomerGroup
            key={group.customerId ?? '__none__'}
            customerId={group.customerId}
            customerName={group.customerName}
            projects={group.projects}
          />
        ))}
      </tbody>
    </table>
  );
}

function CustomerGroup({
  customerId,
  customerName,
  projects,
}: {
  customerId: string | null;
  customerName: string | null;
  projects: PeopleOverviewRow['currentProjects'];
}) {
  return (
    <>
      <tr className="people-customer-header">
        <td colSpan={5} style={{ padding: '8px 4px 4px' }}>
          <span className="people-customer-label">
            {customerId && customerName ? (
              <Link to={`/customers/${customerId}`} className="text-torii hover:underline">
                {customerName}
              </Link>
            ) : (
              <span className="dashboard-em">No customer</span>
            )}
          </span>
          <span className="people-customer-count">
            {projects.length} project{projects.length === 1 ? '' : 's'}
          </span>
        </td>
      </tr>
      {projects.map((p) => (
        <tr key={p.projectId} className="people-project-row">
          <td style={{ padding: '6px 4px 6px 16px' }}>
            <Link to={`/projects/${p.projectId}`} className="text-torii hover:underline">
              {p.projectName}
            </Link>
            <span className="workload-phase-badge">{p.projectPhase}</span>
          </td>
          <td style={{ padding: '6px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {p.weeklyPct}%
          </td>
          <td style={{ padding: '6px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {p.allocatedPct === 0 ? <span className="dashboard-em">—</span> : `${p.allocatedPct}%`}
          </td>
          <td style={{ padding: '6px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {p.lifetimeHours === null
              ? <span className="dashboard-em">—</span>
              : `${p.lifetimeHours.toLocaleString('en-US', { maximumFractionDigits: 1 })}h`}
          </td>
          <td style={{ padding: '6px 4px' }}>
            <span className={`variance-chip variance-chip-${p.varianceBucket}`}>
              {p.varianceBucket === 'neutral' ? 'no data' : p.varianceBucket}
            </span>
          </td>
        </tr>
      ))}
    </>
  );
}

function sortValue(r: PeopleOverviewRow, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return r.name.toLowerCase();
    case 'role':
      return r.role;
    case 'capacity':
      // Sort by committed % — over-commit sorts naturally to the top descending.
      return r.committedPct;
    case 'availability':
      return r.availabilityPct;
    case 'billed30d':
      // Null sorts last in both directions: treat as -1 ascending, infinity descending.
      // We use NaN here so compareSortable can detect and push to end.
      return r.billedHoursLast30d ?? Number.NaN;
    case 'projects':
      return r.currentProjects.length;
    case 'lastReported':
      return r.lastReportedAt ?? '';
  }
}

function compareSortable(a: string | number, b: string | number): number {
  // Push NaN/empty to the end regardless of direction.
  const aMissing = (typeof a === 'number' && Number.isNaN(a)) || a === '';
  const bMissing = (typeof b === 'number' && Number.isNaN(b)) || b === '';
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
