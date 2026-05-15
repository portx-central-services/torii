import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { isoWeekStart, isoDateUtc } from '@torii/shared';
import { endpoints, type CapacityRollup } from '../api/endpoints.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const fromUtc = isoWeekStart(today);
  const toUtc = new Date(fromUtc.getTime() + 12 * WEEK_MS - 1);
  return { from: isoDateUtc(fromUtc), to: isoDateUtc(toUtc) };
}

function demandClass(pct: number): string {
  if (pct === 0) return 'bg-white';
  if (pct < 50) return 'bg-emerald-50';
  if (pct < 100) return 'bg-emerald-100';
  if (pct < 150) return 'bg-amber-100';
  if (pct < 200) return 'bg-orange-200';
  return 'bg-red-300';
}

export function CapacityPage() {
  const initial = defaultRange();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [drillWeek, setDrillWeek] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['capacity', from, to],
    queryFn: () => endpoints.capacityRollup(from, to),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Capacity</h1>
          <p className="text-sm text-gray-500">
            Weekly demand across projects and per-person commitment.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="flex flex-col">
            <span className="text-xs text-gray-600 mb-1">From</span>
            <input
              type="date"
              className="input"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col">
            <span className="text-xs text-gray-600 mb-1">To</span>
            <input
              type="date"
              className="input"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const r = defaultRange();
              setFrom(r.from);
              setTo(r.to);
            }}
          >
            Reset (12 weeks)
          </button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="p-8 text-gray-500">Loading capacity…</div>
      ) : query.isError ? (
        <div className="p-8 text-red-700">
          Could not load capacity: {(query.error as Error).message}
        </div>
      ) : (
        <HeatmapAndDrill
          data={query.data!}
          drillWeek={drillWeek}
          onDrill={setDrillWeek}
        />
      )}
    </div>
  );
}

function HeatmapAndDrill({
  data,
  drillWeek,
  onDrill,
}: {
  data: CapacityRollup;
  drillWeek: string | null;
  onDrill: (w: string | null) => void;
}) {
  // Build project rows: union of project ids across all weeks.
  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of data.weeks) {
      for (const p of w.projects) map.set(p.projectId, p.projectName);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  if (data.weeks.length === 0) {
    return <div className="p-8 text-gray-500">No weeks in range.</div>;
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 overflow-auto">
        {projects.length === 0 ? (
          <div className="p-8 text-gray-500 text-center">
            No allocations in this date range.
          </div>
        ) : (
          <table className="text-xs">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 sticky left-0 bg-gray-50">
                  Project
                </th>
                {data.weeks.map((w) => (
                  <th
                    key={w.weekStart}
                    className={`px-2 py-2 text-center font-medium cursor-pointer hover:bg-gray-100 ${
                      drillWeek === w.weekStart ? 'bg-torii-muted text-torii' : 'text-gray-600'
                    }`}
                    onClick={() => onDrill(drillWeek === w.weekStart ? null : w.weekStart)}
                  >
                    {w.weekStart.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((proj) => (
                <tr key={proj.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 sticky left-0 bg-white">
                    <Link
                      to={`/projects/${proj.id}`}
                      className="text-torii hover:underline"
                    >
                      {proj.name}
                    </Link>
                  </td>
                  {data.weeks.map((w) => {
                    const entry = w.projects.find((p) => p.projectId === proj.id);
                    const pct = entry?.demandPct ?? 0;
                    return (
                      <td
                        key={w.weekStart}
                        className={`px-2 py-2 text-center font-mono ${demandClass(pct)}`}
                        title={`${proj.name}: ${pct}% for week of ${w.weekStart}`}
                      >
                        {pct > 0 ? `${pct}%` : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <DrillDownPanel data={data} drillWeek={drillWeek} onClear={() => onDrill(null)} />
    </div>
  );
}

function DrillDownPanel({
  data,
  drillWeek,
  onClear,
}: {
  data: CapacityRollup;
  drillWeek: string | null;
  onClear: () => void;
}) {
  if (!drillWeek) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 text-sm text-gray-500">
        Click a week column to see per-person commitment.
      </div>
    );
  }
  const week = data.weeks.find((w) => w.weekStart === drillWeek);
  if (!week) return null;
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
        <div>
          <div className="text-xs text-gray-500 uppercase">Week of</div>
          <div className="font-semibold">{week.weekStart}</div>
        </div>
        <button type="button" className="btn-ghost text-sm" onClick={onClear}>
          Close
        </button>
      </div>
      {week.people.length === 0 ? (
        <div className="p-5 text-sm text-gray-500">No commitments this week.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="px-4 py-2 text-left">Person</th>
              <th className="px-4 py-2 text-right">Committed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {week.people.map((p) => (
              <tr
                key={p.personId}
                className={p.overAllocated ? 'bg-red-50' : ''}
                title={
                  p.overAllocated
                    ? `${p.committedPct}% exceeds default capacity of ${p.defaultCapacityPct}%`
                    : ''
                }
              >
                <td className="px-4 py-2">
                  <span className="font-medium">{p.personName}</span>
                  {p.overAllocated && (
                    <span className="ml-2 badge bg-red-100 text-red-700">Over</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {p.committedPct}% / {p.defaultCapacityPct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
