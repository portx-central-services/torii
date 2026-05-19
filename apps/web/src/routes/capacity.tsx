import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isoWeekStart, isoDateUtc } from '@torii/shared';
import { endpoints } from '../api/endpoints.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const fromUtc = isoWeekStart(today);
  const toUtc = new Date(fromUtc.getTime() + 12 * WEEK_MS - 1);
  return { from: isoDateUtc(fromUtc), to: isoDateUtc(toUtc) };
}

type CapacityStatus = 'healthy' | 'low' | 'high' | 'over' | 'bench';
type RoleBucket = 'PM' | 'SA' | 'SC';

function capacityStatus(pct: number): CapacityStatus {
  if (pct === 0) return 'bench';
  if (pct < 50) return 'low';
  if (pct < 85) return 'healthy';
  if (pct < 100) return 'high';
  return 'over';
}

function roleClass(role: string | undefined): RoleBucket {
  if (role === 'PM') return 'PM';
  if (role === 'SA') return 'SA';
  if (role === 'Viewer') return 'SC';
  return 'SC';
}

export function CapacityPage() {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<'all' | 'PM' | 'SA' | 'SC'>('all');
  const [sortBy, setSortBy] = useState<'alloc' | 'name' | 'role'>('alloc');

  const rollupQuery = useQuery({
    queryKey: ['capacity', from, to],
    queryFn: () => endpoints.capacityRollup(from, to),
  });

  const peopleQuery = useQuery({
    queryKey: ['people'],
    queryFn: () => endpoints.listPeople(),
  });

  const weeks = rollupQuery.data?.weeks ?? [];

  useEffect(() => {
    if (!weekStart) {
      const firstWeek = weeks.at(0);
      if (firstWeek) setWeekStart(firstWeek.weekStart);
    }
  }, [weekStart, weeks]);

  const selectedWeek = weeks.find((w) => w.weekStart === weekStart) ?? weeks[0];

  const peopleById = useMemo(
    () => new Map((peopleQuery.data ?? []).map((p) => [p.id, p])),
    [peopleQuery.data],
  );

  const teamRows = useMemo(() => {
    const rows = (selectedWeek?.people ?? []).map((p) => {
      const person = peopleById.get(p.personId);
      const role: RoleBucket = roleClass(person?.role);
      return {
        ...p,
        role,
        status: capacityStatus(p.committedPct),
      };
    });

    const filtered =
      roleFilter === 'all' ? rows : rows.filter((r) => r.role === roleFilter);

    if (sortBy === 'name') {
      filtered.sort((a, b) => a.personName.localeCompare(b.personName));
    } else if (sortBy === 'role') {
      filtered.sort((a, b) => a.role.localeCompare(b.role) || b.committedPct - a.committedPct);
    } else {
      filtered.sort((a, b) => b.committedPct - a.committedPct);
    }

    return filtered;
  }, [peopleById, roleFilter, selectedWeek?.people, sortBy]);

  useEffect(() => {
    if (!selectedPersonId && teamRows.length > 0) {
      const firstPerson = teamRows.at(0);
      if (firstPerson) setSelectedPersonId(firstPerson.personId);
    }
  }, [selectedPersonId, teamRows]);

  const selectedPerson = teamRows.find((p) => p.personId === selectedPersonId) ?? null;

  const allocationsQuery = useQuery({
    queryKey: ['person-allocations', selectedPersonId, selectedWeek?.weekStart, selectedWeek?.weekEnd],
    queryFn: () =>
      endpoints.personAllocations(
        selectedPersonId!,
        selectedWeek!.weekStart,
        selectedWeek!.weekEnd,
      ),
    enabled: !!selectedPersonId && !!selectedWeek,
  });

  const summary = useMemo(() => {
    const rows = selectedWeek?.people ?? [];
    const count = rows.length;
    if (count === 0) {
      return {
        avg: 0,
        over: 0,
        high: 0,
        lowAndBench: 0,
        byRole: { PM: 0, SA: 0, SC: 0 },
      };
    }

    const avg = Math.round(rows.reduce((acc, p) => acc + p.committedPct, 0) / count);
    const over = rows.filter((p) => p.committedPct >= 100).length;
    const high = rows.filter((p) => p.committedPct >= 85 && p.committedPct < 100).length;
    const lowAndBench = rows.filter((p) => p.committedPct < 50).length;

    const byRole: Record<RoleBucket, number> = { PM: 0, SA: 0, SC: 0 };
    for (const p of rows) {
      const role: RoleBucket = roleClass(peopleById.get(p.personId)?.role);
      byRole[role] += 1;
    }

    return { avg, over, high, lowAndBench, byRole };
  }, [peopleById, selectedWeek?.people]);

  return (
    <div className="page-stack">
      <div className="page-header">
        <div className="page-header-title">
          <span className="overline">Delivery Team</span>
          <h1>Team Capacity</h1>
          <div className="page-sub">
            {selectedWeek ? `Week of ${selectedWeek.weekStart}` : 'Choose a week to drill into'}
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi accent">
          <div className="kpi-label">Avg allocation</div>
          <div className="kpi-value">{summary.avg}%</div>
          <div className="kpi-sub">across current week</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Over-allocated</div>
          <div className="kpi-value kpi-danger">{summary.over}</div>
          <div className="kpi-sub">people at 100%+</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">High utilization</div>
          <div className="kpi-value kpi-warning">{summary.high}</div>
          <div className="kpi-sub">between 85% and 99%</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Low / bench</div>
          <div className="kpi-value">{summary.lowAndBench}</div>
          <div className="kpi-sub">below 50%</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Roles</div>
          <div className="kpi-role-line">
            <span>{summary.byRole.PM} PM</span>
            <span>{summary.byRole.SA} SA</span>
            <span>{summary.byRole.SC} SC</span>
          </div>
          <div className="kpi-sub">project, architecture, consulting</div>
        </div>
      </div>

      <div className="filter-row">
        <div className="filter-fields">
          <label className="field-wrap">
            <span className="field-label">From</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field-wrap">
            <span className="field-label">To</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="field-wrap">
            <span className="field-label">Week</span>
            <select
              className="input"
              value={selectedWeek?.weekStart ?? ''}
              onChange={(e) => setWeekStart(e.target.value)}
            >
              {weeks.map((w) => (
                <option key={w.weekStart} value={w.weekStart}>
                  {w.weekStart}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="segmented">
          {(['all', 'PM', 'SA', 'SC'] as const).map((role) => (
            <button
              key={role}
              type="button"
              className={roleFilter === role ? 'on' : ''}
              onClick={() => setRoleFilter(role)}
            >
              {role === 'all' ? 'All roles' : role}
            </button>
          ))}
        </div>

        <div className="segmented">
          {(
            [
              { key: 'alloc', label: 'Allocation' },
              { key: 'name', label: 'Name' },
              { key: 'role', label: 'Role' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={sortBy === opt.key ? 'on' : ''}
              onClick={() => setSortBy(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {rollupQuery.isLoading ? (
        <div className="empty">Loading capacity...</div>
      ) : rollupQuery.isError ? (
        <div className="empty text-red-700">Unable to load capacity: {(rollupQuery.error as Error).message}</div>
      ) : (
        <div className="capacity-grid">
          <div className="card">
            {teamRows.map((person) => {
              const width = Math.min(person.committedPct, 120);
              return (
                <div
                  key={person.personId}
                  className={`cap-row ${selectedPersonId === person.personId ? 'selected' : ''}`}
                  onClick={() => setSelectedPersonId(person.personId)}
                >
                  <div className="cap-person-col">
                    <div className="avatar-sm-round">{person.personName.split(' ').map((v) => v[0]).join('').slice(0, 2)}</div>
                    <div className="cap-person-meta">
                      <span className="cap-person-name">{person.personName}</span>
                      <span className={`role-pill ${person.role}`}>{person.role}</span>
                    </div>
                  </div>
                  <div className="cap-bar-wrap">
                    <div className={`cap-bar cap-status-${person.status}`}>
                      <span style={{ width: `${width}%` }} />
                      <span className="marker-100" />
                    </div>
                  </div>
                  <div className={`cap-pct ${person.status}`}>{person.committedPct}%</div>
                </div>
              );
            })}
          </div>

          <div className="drilldown">
            {!selectedPerson ? (
              <div className="drilldown-empty">Select a person to view week details.</div>
            ) : (
              <>
                <div className="drilldown-head">
                  <div className="avatar-lg-round">
                    {selectedPerson.personName.split(' ').map((v) => v[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <div className="drilldown-name">{selectedPerson.personName}</div>
                    <div className="drilldown-role">
                      <span className={`role-pill ${selectedPerson.role}`}>{selectedPerson.role}</span>
                    </div>
                  </div>
                </div>

                <div className="drilldown-stats">
                  <div className="drilldown-stat">
                    <div className="drilldown-stat-label">Committed</div>
                    <div className="drilldown-stat-value">{selectedPerson.committedPct}%</div>
                  </div>
                  <div className="drilldown-stat">
                    <div className="drilldown-stat-label">Default capacity</div>
                    <div className="drilldown-stat-value">{selectedPerson.defaultCapacityPct}%</div>
                  </div>
                </div>

                <div className="overline">Allocation breakdown</div>

                {allocationsQuery.isLoading ? (
                  <div className="mt-3 text-sm text-gray-500">Loading allocations...</div>
                ) : allocationsQuery.isError ? (
                  <div className="mt-3 text-sm text-red-700">
                    Unable to load allocations: {(allocationsQuery.error as Error).message}
                  </div>
                ) : (allocationsQuery.data?.length ?? 0) === 0 ? (
                  <div className="mt-3 text-sm text-gray-500">No allocations in the selected week.</div>
                ) : (
                  <>
                    <div className="alloc-bar-stacked">
                      {allocationsQuery.data!.map((a, i) => (
                        <div
                          key={a.id}
                          style={{
                            width: `${Math.min(a.pct, 100)}%`,
                            background: `hsl(${(i * 67) % 360} 72% 52%)`,
                          }}
                          title={`${a.project.name}: ${a.pct}%`}
                        />
                      ))}
                    </div>
                    <div className="alloc-list">
                      {allocationsQuery.data!.map((a, i) => (
                        <div key={a.id} className="alloc-row">
                          <span
                            className="alloc-dot"
                            style={{ background: `hsl(${(i * 67) % 360} 72% 52%)` }}
                          />
                          <span className="alloc-name">{a.project.name}</span>
                          <span className="alloc-pct">{a.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
