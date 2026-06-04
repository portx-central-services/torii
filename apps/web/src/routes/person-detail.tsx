import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { varianceBucket, type VarianceBucket } from '@torii/shared';
import {
  endpoints,
  type Person,
  type PersonReconciliationRow,
  type Project,
} from '../api/endpoints.js';
import { PhaseBadge, StateBadge } from '../components/Badge.js';
import { WorkloadSection } from '../components/WorkloadSection.js';
import { useAuth } from '../auth/AuthProvider.js';

type RoleSlug = 'owner' | 'pm' | 'sa' | 'sc';

const ROLE_SECTIONS: Array<{ role: RoleSlug; label: string }> = [
  { role: 'owner', label: 'Owner' },
  { role: 'pm', label: 'Project Manager' },
  { role: 'sa', label: 'Solution Architect' },
  { role: 'sc', label: 'Senior Consultant' },
];

export function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user: viewer } = useAuth();

  const personQ = useQuery({
    queryKey: ['person', id],
    queryFn: () => endpoints.getPerson(id!),
    enabled: !!id,
  });

  const projectsQ = useQuery({
    queryKey: ['person-projects', id],
    queryFn: () => endpoints.personProjects(id!),
    enabled: !!id,
  });

  if (personQ.isLoading) return <div className="text-gray-500">Loading…</div>;
  if (personQ.isError) {
    return <div className="text-red-700">Unable to load person: {(personQ.error as Error).message}</div>;
  }

  const person = personQ.data;
  if (!person) return <div>Not found</div>;

  const projects = projectsQ.data ?? [];
  type RolePlacement = { project: Project; primary: boolean; last30DaysHours: number | null };
  const byRole = new Map<RoleSlug, RolePlacement[]>();
  for (const { role, primary, last30DaysHours, project } of projects) {
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push({ project, primary, last30DaysHours });
  }
  // Sort within each role section by (recent-hours-desc → primary-first → name).
  // Projects with logged hours in the last 30 days bubble to the top so the
  // "what's this person actively working on" signal reads first.
  for (const list of byRole.values()) {
    list.sort((a, b) => {
      const aHas = (a.last30DaysHours ?? 0) > 0;
      const bHas = (b.last30DaysHours ?? 0) > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas) {
        const diff = (b.last30DaysHours ?? 0) - (a.last30DaysHours ?? 0);
        if (diff !== 0) return diff;
      }
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.project.name.localeCompare(b.project.name);
    });
  }

  const canEditWorkload = Boolean(viewer && (viewer.id === person.id || viewer.isAdmin));

  return (
    <div className="page-stack">
      <PersonHeader person={person} />
      <WorkloadSection personId={person.id} editable={canEditWorkload} />
      {ROLE_SECTIONS.map(({ role, label }) => {
        const placements = byRole.get(role) ?? [];
        // Hide entirely when this person has no projects under that role —
        // the empty-state row was noisier than informative.
        if (placements.length === 0) return null;
        return <RoleSection key={role} label={label} placements={placements} />;
      })}
      <ReconciliationSection person={person} />
    </div>
  );
}

/**
 * Allocations vs. Actuals section — one row per project this Person is allocated
 * on. Hidden entirely when the Person has no allocations AND no Harvest link
 * (nothing to show).
 */
function ReconciliationSection({ person }: { person: Person }) {
  const q = useQuery({
    queryKey: ['person-reconciliation', person.id],
    queryFn: () => endpoints.personReconciliation(person.id),
  });

  if (q.isLoading) return null;
  if (q.isError) {
    return (
      <section className="section-card">
        <h3 style={{ marginTop: 0 }}>Allocations vs. Actuals</h3>
        <div className="text-red-700">Unable to load reconciliation: {(q.error as Error).message}</div>
      </section>
    );
  }

  const rows = q.data ?? [];
  // Hide the section entirely when there's nothing meaningful to show.
  if (rows.length === 0 && !person.harvestUserId) return null;

  return (
    <section className="section-card">
      <h3 style={{ marginTop: 0 }}>Allocations vs. Actuals</h3>
      {!person.harvestUserId && (
        <div className="text-sm text-gray-500" style={{ marginBottom: 8 }}>
          This Person isn't linked to a Harvest user yet — actuals will appear once they're linked
          on <Link to="/trackers" className="text-torii hover:underline">/trackers</Link>.
        </div>
      )}
      {rows.length === 0 ? (
        <div className="empty text-sm text-gray-500">No allocations on any project.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--ink-200)' }}>
              <th style={{ padding: '8px 4px' }}>Project</th>
              <th style={{ padding: '8px 4px', textAlign: 'right' }}>Planned</th>
              <th style={{ padding: '8px 4px', textAlign: 'right' }}>Actual</th>
              <th style={{ padding: '8px 4px', textAlign: 'right' }}>Variance</th>
              <th style={{ padding: '8px 4px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ReconciliationRow key={r.projectId} row={r} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ReconciliationRow({ row }: { row: PersonReconciliationRow }) {
  const bucket = varianceBucket(row.plannedHours, row.actualHours);
  return (
    <tr style={{ borderBottom: '1px solid var(--ink-100)' }}>
      <td style={{ padding: '6px 4px' }}>
        <Link to={`/projects/${row.projectId}`} className="text-torii hover:underline">
          {row.projectName}
        </Link>
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtHours(row.plannedHours)}</td>
      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
        {row.actualHours === null ? <span className="text-gray-400">—</span> : fmtHours(row.actualHours)}
      </td>
      <td style={{ padding: '6px 4px', textAlign: 'right' }}>
        {row.variance === null ? (
          <span className="text-gray-400">—</span>
        ) : (
          <span>
            {row.variance >= 0 ? '+' : ''}{fmtHours(row.variance)}
            {row.variancePct !== null && (
              <span className="text-gray-500" style={{ marginLeft: 4 }}>
                ({row.variancePct >= 0 ? '+' : ''}{row.variancePct.toFixed(0)}%)
              </span>
            )}
          </span>
        )}
      </td>
      <td style={{ padding: '6px 4px' }}>
        <VarianceChip bucket={bucket} linkedToHarvest={row.linkedToHarvest} />
      </td>
    </tr>
  );
}

function VarianceChip({ bucket, linkedToHarvest }: { bucket: VarianceBucket; linkedToHarvest: boolean }) {
  if (bucket === 'neutral' && !linkedToHarvest) {
    return <span className="variance-chip variance-chip-neutral">no Harvest link</span>;
  }
  if (bucket === 'neutral') return <span className="variance-chip variance-chip-neutral">no data</span>;
  if (bucket === 'green') return <span className="variance-chip variance-chip-green">On plan</span>;
  if (bucket === 'amber') return <span className="variance-chip variance-chip-amber">Watch</span>;
  return <span className="variance-chip variance-chip-red">Attention</span>;
}

function fmtHours(h: number): string {
  return `${h.toLocaleString('en-US', { maximumFractionDigits: 1 })}h`;
}

function PersonHeader({ person }: { person: Person }) {
  const isSynthetic = person.email.endsWith('@torii.unresolved');
  return (
    <div className="page-header">
      <div className="page-header-title">
        <span className="overline">Person</span>
        <h1>{person.name}</h1>
        <div className="page-sub" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isSynthetic ? (
            <span className="text-gray-500 text-sm">Auto-created from Monday — no SSO email yet</span>
          ) : (
            <span className="text-sm">{person.email}</span>
          )}
          <span className="badge bg-gray-100 text-gray-700">{person.role}</span>
          {person.isAdmin && (
            <span className="badge bg-amber-50 text-amber-800">Admin</span>
          )}
        </div>
      </div>
    </div>
  );
}

function RoleSection({
  label,
  placements,
}: {
  label: string;
  placements: Array<{ project: Project; primary: boolean; last30DaysHours: number | null }>;
}) {
  return (
    <section className="section-card">
      <h3 style={{ marginTop: 0 }}>
        {label} <span className="text-sm text-gray-500">({placements.length})</span>
      </h3>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {placements.map(({ project: p, primary, last30DaysHours }) => (
          <li
            key={`${p.id}-${primary ? 'primary' : 'secondary'}`}
            className="person-project-row"
            style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--ink-100)' }}
          >
            <Link to={`/projects/${p.id}`} className="text-torii hover:underline" style={{ flex: 1 }}>
              {p.name}
            </Link>
            {last30DaysHours !== null && last30DaysHours > 0 && (
              <span className="person-project-30d" title="Hours logged in the last 30 days">
                30d: {last30DaysHours.toLocaleString('en-US', { maximumFractionDigits: 1 })}h
              </span>
            )}
            {!primary && (
              <span className="role-co-chip" title="Shared role with another person on Monday">
                Co-{label.split(' ').map((w) => w[0]).join('').toUpperCase()}
              </span>
            )}
            <PhaseBadge phase={p.phase} />
            <StateBadge state={p.state} />
            {p.overBudget && (
              <span className="badge bg-red-50 text-red-700">Over budget</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
