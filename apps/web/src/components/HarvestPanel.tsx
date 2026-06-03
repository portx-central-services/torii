import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  endpoints,
  type HarvestProjectSnapshot,
  type Project,
  type ProjectDetailKey,
} from '../api/endpoints.js';
import { ApiError } from '../api/client.js';

interface HarvestPanelProps {
  project: Project;
  isPm: boolean;
}

/**
 * Project-detail Harvest panel — hours-only by design (D9). Renders one sub-row per
 * pinned Harvest project (a Torii project can have many — typically one per phase),
 * plus a total line summing across them. The customer-level rollup (including any
 * "support" Harvest projects not pinned to a specific Torii project) lives on
 * `/customers/:id`.
 */
export function HarvestPanel({ project, isPm }: HarvestPanelProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const snapQ = useQuery({
    queryKey: ['harvest-snapshot', project.id],
    queryFn: () => endpoints.getProjectHarvest(project.id),
    retry: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => endpoints.refreshProjectHarvest(project.id),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['harvest-snapshot', project.id] });
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? e.status === 429
            ? 'Harvest is rate-limited — retry in 15 seconds.'
            : e.message
          : 'Refresh failed',
      ),
  });

  if (snapQ.isLoading) {
    return (
      <section className="section-card harvest-panel">
        <div className="empty">Loading Harvest snapshot…</div>
      </section>
    );
  }

  if (snapQ.isError) {
    return (
      <section className="section-card harvest-panel">
        <div className="text-red-700">
          Unable to load Harvest snapshot: {(snapQ.error as Error).message}
        </div>
      </section>
    );
  }

  const harvestProjects = snapQ.data?.harvestProjects ?? [];

  if (harvestProjects.length === 0) {
    return (
      <section className="section-card harvest-panel">
        <div className="harvest-panel-header">
          <h3>Harvest</h3>
        </div>
        <div className="empty">
          No Harvest project pinned for phase-level reconciliation.{' '}
          {project.customerId ? (
            <>
              See the{' '}
              <Link to={`/customers/${project.customerId}`}>customer page</Link> for the customer-wide
              rollup.
            </>
          ) : (
            <>
              Map this project to a customer in <Link to="/trackers">Trackers</Link> first.
            </>
          )}
        </div>
      </section>
    );
  }

  const totalSpent = harvestProjects.reduce(
    (s, hp) => s + hp.spentHoursBillable + hp.spentHoursNonbillable,
    0,
  );
  const totalBudget = harvestProjects.reduce(
    (s, hp) => s + (hp.budgetHours ?? 0),
    0,
  );
  const anyBudget = harvestProjects.some((hp) => hp.budgetHours !== null);
  const remaining = anyBudget ? totalBudget - totalSpent : null;
  const pctOver =
    anyBudget && totalBudget > 0
      ? Math.round(((totalSpent - totalBudget) / totalBudget) * 100)
      : null;
  const isOver = pctOver !== null && pctOver > 0;
  const fillPct = anyBudget && totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;

  const newest = harvestProjects.reduce<Date | null>((latest, hp) => {
    const d = new Date(hp.fetchedAt);
    if (!latest || d > latest) return d;
    return latest;
  }, null);

  return (
    <section className="section-card harvest-panel">
      <div className="harvest-panel-header">
        <h3>
          Harvest <span className="harvest-panel-count">{harvestProjects.length} pinned</span>
        </h3>
        <div className="harvest-panel-header-actions">
          {newest && (
            <span className="harvest-panel-refresh-time">
              Updated {relativeTime(newest)}
            </span>
          )}
          {isPm && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              {refreshMutation.isPending ? 'Refreshing…' : 'Refresh from Harvest'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="text-red-700" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="harvest-tiles">
        <Tile label="Total hours">
          <div className="harvest-tile-value">{fmtHours(totalSpent)}</div>
          <div className="harvest-tile-sub">Across {harvestProjects.length} Harvest project{harvestProjects.length === 1 ? '' : 's'}</div>
        </Tile>
        <Tile label="Budget hours">
          <div className="harvest-tile-value">
            {anyBudget ? fmtHours(totalBudget) : '—'}
          </div>
          <div className="harvest-tile-sub">
            {anyBudget ? 'Sum of pinned budgets' : 'No budgets set in Harvest'}
          </div>
        </Tile>
        <Tile label="Budget remaining">
          <div className={`harvest-tile-value ${isOver ? 'text-red-700' : ''}`}>
            {remaining === null ? '—' : fmtHours(remaining)}
            {pctOver !== null && (
              <span className="harvest-tile-pct"> ({pctOver > 0 ? '+' : ''}{pctOver}%)</span>
            )}
          </div>
          {anyBudget && totalBudget > 0 && (
            <div className="harvest-budget-bar">
              <div
                className={`harvest-budget-bar-fill ${isOver ? 'harvest-budget-bar-fill-over' : ''}`}
                style={{ width: `${fillPct}%` }}
              />
              {isOver && <div className="harvest-budget-bar-overflow" />}
            </div>
          )}
        </Tile>
      </div>

      <div className="harvest-projects-list">
        {harvestProjects.map((hp) => (
          <HarvestProjectRow key={hp.id} snapshot={hp} project={project} />
        ))}
      </div>
    </section>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="harvest-tile">
      <div className="harvest-tile-label">{label}</div>
      {children}
    </div>
  );
}

function HarvestProjectRow({
  snapshot,
  project,
}: {
  snapshot: HarvestProjectSnapshot;
  project: Project;
}) {
  const [open, setOpen] = useState(false);
  const spent = snapshot.spentHoursBillable + snapshot.spentHoursNonbillable;

  return (
    <div className="harvest-project-row">
      <div className="harvest-project-row-head">
        <div className="harvest-project-row-name">
          <a href={snapshot.harvestProjectUrl} target="_blank" rel="noopener noreferrer">
            {snapshot.name}
          </a>
          <span className={`harvest-billable-badge ${snapshot.isBillable ? 'billable' : 'non-billable'}`}>
            {snapshot.isBillable ? 'Billable' : 'Non-billable'}
          </span>
        </div>
        <div className="harvest-project-row-stats">
          <span className="harvest-project-row-spent">{fmtHours(spent)}</span>
          {snapshot.budgetHours !== null && (
            <span className="harvest-project-row-budget"> / {fmtHours(snapshot.budgetHours)}</span>
          )}
        </div>
      </div>
      {snapshot.breakdown.length > 0 && (
        <details
          className="harvest-breakdown"
          open={open}
          onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            By task and person ({snapshot.breakdown.length} task
            {snapshot.breakdown.length === 1 ? '' : 's'})
          </summary>
          <div className="harvest-breakdown-body">
            {snapshot.breakdown.map((task) => (
              <div key={task.taskId} className="harvest-task-group">
                <div className="harvest-task-header">
                  <span className="harvest-task-name">{task.taskName}</span>
                  <span className="harvest-task-hours">
                    {fmtHours(task.taskSpentHours)}
                    {task.taskBudgetHours !== null && (
                      <span className="harvest-task-budget"> / {fmtHours(task.taskBudgetHours)}</span>
                    )}
                  </span>
                </div>
                <div className="harvest-person-rows">
                  {task.people.map((person) => {
                    const role = matchPersonRole(person.personName, project);
                    return (
                      <div key={person.personId} className="harvest-person-row">
                        <span className="harvest-person-name">
                          {role && <span className="harvest-role-badge">{role}</span>}
                          {person.personName}
                          {person.archived && <span className="harvest-archived"> (archived)</span>}
                        </span>
                        <span className="harvest-person-hours">{fmtHours(person.hours)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function matchPersonRole(personName: string, project: Project): 'PM' | 'SA' | 'SC' | null {
  const target = personName.trim().toLowerCase();
  if (!target) return null;
  const pairs: Array<{ key: ProjectDetailKey; label: 'PM' | 'SA' | 'SC' }> = [
    { key: 'project_manager', label: 'PM' },
    { key: 'solution_architect', label: 'SA' },
    { key: 'solution_consultant', label: 'SC' },
  ];
  for (const { key, label } of pairs) {
    const v = project.details?.[key]?.trim().toLowerCase();
    if (v && v === target) return label;
  }
  return null;
}

function fmtHours(h: number): string {
  return `${h.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: h % 1 === 0 ? 0 : 2 })}h`;
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}
