import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  plannedHoursForAllocation,
  varianceBucket,
  type VarianceBucket,
} from '@torii/shared';
import { endpoints, type HarvestSnapshot, type Person } from '../api/endpoints.js';
import { ApiError } from '../api/client.js';

/**
 * Per-project Allocations vs. Actuals reconciliation panel. Joins three data
 * sources the page has already loaded:
 *
 *   - `endpoints.getProject(id)` for `allocations` (shared cache with AllocationsPanel)
 *   - `endpoints.listPeople()` for each allocated Person's `defaultCapacityPct` + `harvestUserId`
 *   - `endpoints.getHarvestSnapshot(id)` for the per-(task, person) `hours` breakdown
 *     (shared cache with HarvestPanel)
 *
 * All math runs client-side; no new endpoint needed.
 */
export function ReconciliationPanel({ projectId }: { projectId: string }) {
  const projectQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => endpoints.getProject(projectId),
  });
  const peopleQ = useQuery({
    queryKey: ['people'],
    queryFn: () => endpoints.listPeople(),
  });
  const snapQ = useQuery({
    queryKey: ['harvest-snapshot', projectId],
    queryFn: () => endpoints.getHarvestSnapshot(projectId),
    retry: false,
  });

  if (projectQ.isLoading || peopleQ.isLoading) {
    return (
      <section className="section-card">
        <h3 style={{ marginTop: 0 }}>Allocations vs. Actuals</h3>
        <div className="empty">Loading…</div>
      </section>
    );
  }

  const project = projectQ.data;
  const people = peopleQ.data ?? [];
  if (!project) return null;

  const allocations = project.allocations ?? [];
  const peopleById = new Map(people.map((p) => [p.id, p]));

  // Snapshot may be missing (no Harvest link OR not yet refreshed) — that's a
  // distinct render state from "no allocations".
  const isSnapshotMissing = snapQ.isError && snapQ.error instanceof ApiError && snapQ.error.status === 404;
  const snapshot: HarvestSnapshot | undefined = snapQ.data;

  if (allocations.length === 0) {
    return (
      <section className="section-card">
        <h3 style={{ marginTop: 0 }}>Allocations vs. Actuals</h3>
        <div className="empty text-sm text-gray-500">No allocations on this project.</div>
      </section>
    );
  }

  if (isSnapshotMissing) {
    return (
      <section className="section-card">
        <h3 style={{ marginTop: 0 }}>Allocations vs. Actuals</h3>
        <div className="empty text-sm text-gray-500">
          No Harvest snapshot — refresh the project from the Harvest panel to populate actuals.
        </div>
      </section>
    );
  }

  // Aggregate planned hours per allocated person.
  interface Row {
    personId: string;
    personName: string;
    plannedHours: number;
    actualHours: number | null;
    linkedToHarvest: boolean;
  }
  const rowsByPerson = new Map<string, Row>();
  for (const a of allocations) {
    const person = peopleById.get(a.personId);
    if (!person) continue;
    const planned = plannedHoursForAllocation({
      pct: a.pct,
      defaultCapacityPct: person.defaultCapacityPct,
      startISO: a.start,
      endISO: a.end,
    });
    const existing = rowsByPerson.get(a.personId);
    if (existing) {
      existing.plannedHours += planned;
    } else {
      rowsByPerson.set(a.personId, {
        personId: a.personId,
        personName: person.name,
        plannedHours: planned,
        actualHours: null,
        linkedToHarvest: Boolean(person.harvestUserId),
      });
    }
  }

  // Walk the snapshot breakdown once, indexing by harvest personId, then back-fill
  // each Row's actualHours by looking up the allocated Person's harvestUserId.
  const harvestHoursById = new Map<string, number>();
  if (snapshot) {
    for (const task of snapshot.breakdown) {
      for (const p of task.people) {
        harvestHoursById.set(p.personId, (harvestHoursById.get(p.personId) ?? 0) + p.hours);
      }
    }
  }
  for (const row of rowsByPerson.values()) {
    const person = peopleById.get(row.personId);
    if (person?.harvestUserId) {
      row.actualHours = Number((harvestHoursById.get(person.harvestUserId) ?? 0).toFixed(2));
    }
    row.plannedHours = Number(row.plannedHours.toFixed(2));
  }

  const rows = [...rowsByPerson.values()].sort((a, b) => a.personName.localeCompare(b.personName));

  // "Logged but not allocated": Harvest people who logged hours but aren't on the
  // project's allocation list. Resolved via reverse-lookup: harvest user id → Torii Person.
  const allocatedPersonIds = new Set(allocations.map((a) => a.personId));
  const peopleByHarvestId = new Map(
    people.filter((p) => p.harvestUserId).map((p) => [p.harvestUserId!, p]),
  );
  const unallocated: Array<{ harvestUserId: string; person: Person | null; hours: number }> = [];
  for (const [harvestUserId, hours] of harvestHoursById.entries()) {
    const person = peopleByHarvestId.get(harvestUserId) ?? null;
    if (person && allocatedPersonIds.has(person.id)) continue; // already in the main table
    unallocated.push({ harvestUserId, person, hours: Number(hours.toFixed(2)) });
  }
  unallocated.sort((a, b) => (a.person?.name ?? a.harvestUserId).localeCompare(b.person?.name ?? b.harvestUserId));

  // If no allocated Person is linked to a Harvest user AND no snapshot data
  // matches, render a CTA toward the /trackers link table rather than empty rows.
  const anyAllocatedLinked = rows.some((r) => r.linkedToHarvest);
  if (!snapshot) {
    return (
      <section className="section-card">
        <h3 style={{ marginTop: 0 }}>Allocations vs. Actuals</h3>
        <ReconciliationTable rows={rows} />
        {!anyAllocatedLinked && (
          <div className="text-sm text-gray-500" style={{ marginTop: 8 }}>
            None of the allocated people are linked to Harvest users yet.{' '}
            <Link to="/trackers" className="text-torii hover:underline">Link them on /trackers</Link>.
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="section-card">
      <h3 style={{ marginTop: 0 }}>Allocations vs. Actuals</h3>
      <ReconciliationTable rows={rows} />
      {!anyAllocatedLinked && (
        <div className="text-sm text-gray-500" style={{ marginTop: 8 }}>
          None of the allocated people are linked to Harvest users yet.{' '}
          <Link to="/trackers" className="text-torii hover:underline">Link them on /trackers</Link>.
        </div>
      )}
      {unallocated.length > 0 && (
        <details className="reconciliation-unallocated" style={{ marginTop: 16 }}>
          <summary>Logged but not allocated ({unallocated.length})</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--ink-200)' }}>
                <th style={{ padding: '6px 4px' }}>Person</th>
                <th style={{ padding: '6px 4px', textAlign: 'right' }}>Actual hours</th>
              </tr>
            </thead>
            <tbody>
              {unallocated.map((u) => (
                <tr key={u.harvestUserId} style={{ borderBottom: '1px solid var(--ink-100)' }}>
                  <td style={{ padding: '6px 4px' }}>
                    {u.person ? (
                      <Link to={`/people/${u.person.id}`} className="text-torii hover:underline">
                        {u.person.name}
                      </Link>
                    ) : (
                      <span className="text-gray-500">Harvest user {u.harvestUserId} (no Torii Person linked)</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtHours(u.hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function ReconciliationTable({
  rows,
}: {
  rows: Array<{
    personId: string;
    personName: string;
    plannedHours: number;
    actualHours: number | null;
    linkedToHarvest: boolean;
  }>;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--ink-200)' }}>
          <th style={{ padding: '8px 4px' }}>Person</th>
          <th style={{ padding: '8px 4px', textAlign: 'right' }}>Planned</th>
          <th style={{ padding: '8px 4px', textAlign: 'right' }}>Actual</th>
          <th style={{ padding: '8px 4px', textAlign: 'right' }}>Variance</th>
          <th style={{ padding: '8px 4px' }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const bucket = varianceBucket(r.plannedHours, r.actualHours);
          const variance = r.actualHours === null ? null : r.actualHours - r.plannedHours;
          const variancePct = r.actualHours === null || r.plannedHours <= 0
            ? null
            : ((r.actualHours - r.plannedHours) / r.plannedHours) * 100;
          return (
            <tr key={r.personId} style={{ borderBottom: '1px solid var(--ink-100)' }}>
              <td style={{ padding: '6px 4px' }}>
                <Link to={`/people/${r.personId}`} className="text-torii hover:underline">
                  {r.personName}
                </Link>
              </td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtHours(r.plannedHours)}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                {r.actualHours === null ? <span className="text-gray-400">—</span> : fmtHours(r.actualHours)}
              </td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                {variance === null ? (
                  <span className="text-gray-400">—</span>
                ) : (
                  <span>
                    {variance >= 0 ? '+' : ''}{fmtHours(variance)}
                    {variancePct !== null && (
                      <span className="text-gray-500" style={{ marginLeft: 4 }}>
                        ({variancePct >= 0 ? '+' : ''}{variancePct.toFixed(0)}%)
                      </span>
                    )}
                  </span>
                )}
              </td>
              <td style={{ padding: '6px 4px' }}>
                <VarianceChip bucket={bucket} linkedToHarvest={r.linkedToHarvest} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
