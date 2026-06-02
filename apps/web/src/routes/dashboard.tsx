import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PHASES, PHASE_LABELS, type Phase, type RagLevel } from '@torii/shared';
import { endpoints, type DashboardSummary } from '../api/endpoints.js';
import { PHASE_BG } from './timeline.js';

export function PortfolioDashboardPage() {
  const summary = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => endpoints.getDashboardSummary(),
  });

  if (summary.isLoading) {
    return (
      <div className="page-stack">
        <DashboardHeader />
        <div className="text-gray-500">Loading…</div>
      </div>
    );
  }
  if (summary.isError) {
    return (
      <div className="page-stack">
        <DashboardHeader />
        <div className="text-red-700">
          Unable to load dashboard: {(summary.error as Error).message}
        </div>
      </div>
    );
  }

  const data = summary.data as DashboardSummary;

  return (
    <div className="page-stack">
      <DashboardHeader />
      <HeroKpiBand kpis={data.kpis} />
      <div className="dashboard-grid">
        <RiskPictureCard rag={data.thisWeekRag} />
        <SchedulePressureCard rows={data.schedulePressure} />
        <NeedsAttentionRow
          noRiskUpdate={data.noRiskUpdate}
          slipping={data.slipping}
        />
        <PhaseDistributionCard counts={data.phaseCounts} />
      </div>
    </div>
  );
}

function DashboardHeader() {
  return (
    <div className="page-header">
      <div className="page-header-title">
        <span className="overline">Portfolio</span>
        <h1>Dashboard</h1>
        <div className="page-sub">
          Monday morning briefing: what's at risk, what's launching, what needs attention.
        </div>
      </div>
    </div>
  );
}

function HeroKpiBand({ kpis }: { kpis: DashboardSummary['kpis'] }) {
  return (
    <div className="kpi-row dashboard-kpi-row">
      <KpiTile
        to="/projects"
        label="Active"
        value={kpis.active}
        sub="state ≠ Done"
        accent
      />
      <KpiTile
        to="/risks"
        label="At risk"
        value={kpis.atRisk}
        sub="latest RAG ≠ Green"
        valueClass="kpi-warning"
      />
      <KpiTile
        to="/projects?tile=blocked"
        label="Over budget"
        value={kpis.overBudget}
        sub="spent > budget"
        valueClass="kpi-danger"
      />
      <KpiTile
        to="/projects"
        label="Launching ≤ 30d"
        value={kpis.launchingSoon}
        sub="target go-live window"
      />
      <KpiTile
        to="/projects"
        label="Avg slip"
        value={
          kpis.avgSlipDays === null
            ? '—'
            : `${kpis.avgSlipDays >= 0 ? '+' : ''}${Math.round(kpis.avgSlipDays)}d`
        }
        sub="Done: actual vs. baseline"
      />
      <KpiTile
        label="People involved"
        value={kpis.peopleInvolved}
        sub="across active projects"
      />
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: number | string;
  sub: string;
  to?: string;
  accent?: boolean;
  valueClass?: string;
}

function KpiTile({ label, value, sub, to, accent, valueClass }: KpiTileProps) {
  const cls = ['kpi', accent ? 'accent' : ''].filter(Boolean).join(' ');
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${valueClass ?? ''}`}>{value}</div>
      <div className="kpi-sub">{sub}</div>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls} style={{ textDecoration: 'none', color: 'inherit' }}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

function RiskPictureCard({ rag }: { rag: DashboardSummary['thisWeekRag'] }) {
  return (
    <section className="dashboard-card" aria-labelledby="dashboard-risk-picture">
      <div className="dashboard-card-head">
        <h2 id="dashboard-risk-picture">This week's risk picture</h2>
        <div className="dashboard-card-sub">Counts compared to the prior ISO week.</div>
      </div>
      <div className="dashboard-rag-chips">
        <RagChip level="Red" count={rag.red} prev={rag.prevRed} linkTo="/risks" />
        <RagChip level="Amber" count={rag.amber} prev={rag.prevAmber} linkTo="/risks" />
        <RagChip level="Green" count={rag.green} prev={rag.prevGreen} />
      </div>
    </section>
  );
}

function RagChip({
  level,
  count,
  prev,
  linkTo,
}: {
  level: RagLevel;
  count: number;
  prev: number;
  linkTo?: string;
}) {
  const className = `dashboard-rag-tile rag-${level.toLowerCase()}`;
  const body = (
    <>
      <div className="dashboard-rag-level">{level}</div>
      <div className="dashboard-rag-count">{count}</div>
      <div className="dashboard-rag-prev">was {prev}</div>
    </>
  );
  if (linkTo) {
    return (
      <Link to={linkTo} className={className} style={{ textDecoration: 'none', color: 'inherit' }}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

function SchedulePressureCard({ rows }: { rows: DashboardSummary['schedulePressure'] }) {
  return (
    <section className="dashboard-card" aria-labelledby="dashboard-schedule-pressure">
      <div className="dashboard-card-head">
        <h2 id="dashboard-schedule-pressure">Schedule pressure</h2>
        <div className="dashboard-card-sub">Projects launching in the next 30 days.</div>
      </div>
      {rows.length === 0 ? (
        <div className="dashboard-empty">Nothing launching in the next 30 days.</div>
      ) : (
        <ul className="dashboard-list">
          {rows.map((row) => (
            <li key={row.projectId} className="dashboard-list-row">
              <Link to={`/projects/${row.projectId}`} className="dashboard-list-name">
                {row.projectName}
              </Link>
              <div className="dashboard-list-meta">
                <span className="dashboard-date">{row.targetGoLive}</span>
                <span className="dashboard-days">
                  {row.daysUntil === 0
                    ? 'today'
                    : row.daysUntil === 1
                      ? 'tomorrow'
                      : `in ${row.daysUntil}d`}
                </span>
                <PhaseBadge phase={row.phase} />
                {row.ragLevel ? <span className={`rag-chip rag-${row.ragLevel.toLowerCase()}`}>{row.ragLevel}</span> : <span className="dashboard-em">—</span>}
                {row.overBudget && <span className="dashboard-budget-chip">Over budget</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span
      className="dashboard-phase-badge"
      style={{ background: PHASE_BG[phase], color: needsDarkText(phase) ? '#000' : '#fff' }}
    >
      {PHASE_LABELS[phase]}
    </span>
  );
}

function needsDarkText(phase: Phase): boolean {
  // Brighter mid-spectrum phases get black text; saturated/dark phases get white.
  return (
    phase === 'Development' ||
    phase === 'UAT' ||
    phase === 'GoLiveReadiness' ||
    phase === 'Production'
  );
}

function NeedsAttentionRow({
  noRiskUpdate,
  slipping,
}: {
  noRiskUpdate: DashboardSummary['noRiskUpdate'];
  slipping: DashboardSummary['slipping'];
}) {
  return (
    <div className="dashboard-attention-row">
      <section className="dashboard-card" aria-labelledby="dashboard-no-update">
        <div className="dashboard-card-head">
          <h2 id="dashboard-no-update">No risk update this week</h2>
          <div className="dashboard-card-sub">Active projects missing a current-week RAG entry.</div>
        </div>
        {noRiskUpdate.length === 0 ? (
          <div className="dashboard-empty">Everyone has filed an update.</div>
        ) : (
          <ul className="dashboard-list">
            {noRiskUpdate.map((row) => (
              <li key={row.projectId} className="dashboard-list-row">
                <Link to={`/projects/${row.projectId}`} className="dashboard-list-name">
                  {row.projectName}
                </Link>
                <div className="dashboard-list-meta">
                  {row.latestRagLevel ? (
                    <span className={`rag-chip rag-${row.latestRagLevel.toLowerCase()}`}>
                      {row.latestRagLevel}
                    </span>
                  ) : (
                    <span className="dashboard-em">no prior update</span>
                  )}
                  <span className="dashboard-stale">
                    {row.weeksSinceLastUpdate === null
                      ? 'never'
                      : row.weeksSinceLastUpdate === 0
                        ? 'this week (other day)'
                        : `${row.weeksSinceLastUpdate}w ago`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dashboard-card" aria-labelledby="dashboard-slipping">
        <div className="dashboard-card-head">
          <h2 id="dashboard-slipping">Slipping</h2>
          <div className="dashboard-card-sub">Active projects whose target date has slipped past baseline.</div>
        </div>
        {slipping.length === 0 ? (
          <div className="dashboard-empty">No active projects are slipping.</div>
        ) : (
          <ul className="dashboard-list">
            {slipping.map((row) => (
              <li key={row.projectId} className="dashboard-list-row">
                <Link to={`/projects/${row.projectId}`} className="dashboard-list-name">
                  {row.projectName}
                </Link>
                <div className="dashboard-list-meta">
                  <span className="dashboard-date">baseline {row.baselineGoLive}</span>
                  <span className="dashboard-arrow">→</span>
                  <span className="dashboard-date">target {row.targetGoLive}</span>
                  <span className="dashboard-slip">+{row.slipDays}d</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PhaseDistributionCard({ counts }: { counts: DashboardSummary['phaseCounts'] }) {
  const total = PHASES.reduce((sum, p) => sum + (counts[p] ?? 0), 0);
  return (
    <section className="dashboard-card" aria-labelledby="dashboard-phase-distribution">
      <div className="dashboard-card-head">
        <h2 id="dashboard-phase-distribution">Phase distribution</h2>
        <div className="dashboard-card-sub">{total} active projects across phases.</div>
      </div>
      {total === 0 ? (
        <div className="dashboard-empty">No active projects.</div>
      ) : (
        <>
          <div className="dashboard-stacked-bar">
            {PHASES.map((p) => {
              const value = counts[p] ?? 0;
              if (value === 0) return null;
              const pct = (value / total) * 100;
              return (
                <Link
                  key={p}
                  to="/projects"
                  className="dashboard-stacked-bar-segment"
                  style={{ width: `${pct}%`, background: PHASE_BG[p] }}
                  title={`${PHASE_LABELS[p]}: ${value} project${value === 1 ? '' : 's'}`}
                  aria-label={`${PHASE_LABELS[p]}: ${value} projects`}
                />
              );
            })}
          </div>
          <div className="dashboard-phase-legend">
            {PHASES.map((p) => (
              <div key={p} className="dashboard-phase-legend-item">
                <span
                  className="dashboard-phase-legend-swatch"
                  style={{ background: PHASE_BG[p] }}
                />
                <span className="dashboard-phase-legend-label">{PHASE_LABELS[p]}</span>
                <span className="dashboard-phase-legend-count">{counts[p] ?? 0}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
