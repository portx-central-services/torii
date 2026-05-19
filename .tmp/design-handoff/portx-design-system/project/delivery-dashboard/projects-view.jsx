/* Projects overview — dense table */

function RAG({ value }) {
  return <span className={'rag rag-' + value} title={value} />;
}

function RAGCluster({ health }) {
  return (
    <span className="rag-cluster" title={`Sched ${health.schedule} · Scope ${health.scope} · Budget ${health.budget}`}>
      <RAG value={health.schedule} />
      <RAG value={health.scope} />
      <RAG value={health.budget} />
    </span>
  );
}

function PhasePill({ phase, index }) {
  return (
    <span className="phase-pill">
      <span className="dot" />
      {phase.label}
      <span className="mono text-xs muted" style={{ opacity: 0.6 }}>{index + 1}/10</span>
    </span>
  );
}

function CustChip({ type }) {
  const labels = { bank: 'Bank', cu: 'Credit Union', fintech: 'Fintech' };
  return <span className={'cust-chip ' + type}>{labels[type]}</span>;
}

function ProgressBar({ pct, thick }) {
  return (
    <div className={'bar' + (thick ? ' thick' : '')}>
      <span style={{ width: pct + '%' }} />
    </div>
  );
}

function fmtRelDate(date, today) {
  const days = Math.round((date - today) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 0 && days < 30) return `in ${days}d`;
  if (days < 0 && days > -30) return `${-days}d ago`;
  return new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ProjectsView({ projects, portfolio, today, helpers, setRoute }) {
  const [filter, setFilter] = React.useState('all');
  const [phaseFilter, setPhaseFilter] = React.useState('all');
  const [sortBy, setSortBy] = React.useState('goLive');

  const filtered = React.useMemo(() => {
    let list = projects.slice();
    if (filter === 'risk') list = list.filter(p => helpers.worstHealth(p.health) !== 'green');
    if (filter === 'soon') list = list.filter(p => {
      const days = (p.goLive - today) / 86400000;
      return days >= 0 && days <= 60 && p.phaseIndex < 8;
    });
    if (filter === 'live') list = list.filter(p => p.phaseIndex >= 7);
    if (phaseFilter !== 'all') list = list.filter(p => p.phase.key === phaseFilter);
    if (sortBy === 'goLive') list.sort((a, b) => a.goLive - b.goLive);
    if (sortBy === 'progress') list.sort((a, b) => b.progress - a.progress);
    if (sortBy === 'customer') list.sort((a, b) => a.customer.localeCompare(b.customer));
    if (sortBy === 'risk') {
      const order = { red: 0, amber: 1, green: 2 };
      list.sort((a, b) => order[helpers.worstHealth(a.health)] - order[helpers.worstHealth(b.health)]);
    }
    return list;
  }, [projects, filter, phaseFilter, sortBy]);

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-title">
          <span className="overline">Delivery Portfolio · FY26 Q2</span>
          <h1>Projects</h1>
          <div className="page-sub">{filtered.length} of {projects.length} active integration deliveries · last refreshed just now</div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-ghost"><Icon.Download width={14} height={14} />Export</button>
          <button className="btn btn-ghost"><Icon.Filter width={14} height={14} />Add filter</button>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi accent">
          <div className="kpi-label">Active</div>
          <div className="kpi-value">{portfolio.total}</div>
          <div className="kpi-sub">across banks, credit unions, and fintechs</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">On track</div>
          <div className="kpi-value" style={{ color: 'var(--status-success)' }}>{portfolio.onTrack}</div>
          <div className="kpi-sub">all three dimensions green</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">At risk</div>
          <div className="kpi-value" style={{ color: 'var(--status-warning)' }}>{portfolio.atRisk}</div>
          <div className="kpi-sub">one or more amber</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Blocked</div>
          <div className="kpi-value" style={{ color: 'var(--status-danger)' }}>{portfolio.blocked}</div>
          <div className="kpi-sub">red on schedule, scope, or budget</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Going live ≤ 60d</div>
          <div className="kpi-value">{portfolio.goingLiveSoon}</div>
          <div className="kpi-sub">{portfolio.inHypercare} in hypercare</div>
        </div>
      </div>

      <div className="filter-row">
        <div className="segmented">
          {[
            { k: 'all',  l: 'All projects' },
            { k: 'risk', l: 'At risk' },
            { k: 'soon', l: 'Launching soon' },
            { k: 'live', l: 'Live / Hypercare' },
          ].map(o => (
            <button key={o.k} className={filter === o.k ? 'on' : ''} onClick={() => setFilter(o.k)}>
              {o.l}
            </button>
          ))}
        </div>
        <div className="row gap-2" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fg-muted)' }}>
          <span>Sort:</span>
          <div className="segmented">
            {[
              { k: 'goLive',  l: 'Go-Live' },
              { k: 'progress', l: 'Progress' },
              { k: 'risk',    l: 'Risk' },
              { k: 'customer', l: 'Customer' },
            ].map(o => (
              <button key={o.k} className={sortBy === o.k ? 'on' : ''} onClick={() => setSortBy(o.k)}>{o.l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 38 }}></th>
              <th>Project</th>
              <th>Customer</th>
              <th>Phase</th>
              <th style={{ width: 180 }}>Progress</th>
              <th>Health (S · Sc · B)</th>
              <th>Target go-live</th>
              <th>Team</th>
              <th style={{ width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const worst = helpers.worstHealth(p.health);
              const days = Math.round((p.goLive - today) / 86400000);
              const dateStyle = days < 0
                ? { color: 'var(--status-success)' }
                : days < 14
                  ? { color: 'var(--status-warning)' }
                  : {};
              return (
                <tr key={p.id} onClick={() => setRoute({ view: 'project-detail', projectId: p.id })}>
                  <td><RAG value={worst} /></td>
                  <td>
                    <div className="proj-cell">
                      <span className="name">{p.shortName}</span>
                      <span className="id">{p.id} · {p.core}</span>
                    </div>
                  </td>
                  <td><CustChip type={p.customerType} /></td>
                  <td><PhasePill phase={p.phase} index={p.phaseIndex} /></td>
                  <td>
                    <div className="row gap-2">
                      <div style={{ flex: 1 }}><ProgressBar pct={p.progress} /></div>
                      <span className="mono text-xs" style={{ minWidth: 28, textAlign: 'right' }}>{p.progress}%</span>
                    </div>
                  </td>
                  <td><RAGCluster health={p.health} /></td>
                  <td>
                    <div className="col" style={{ gap: 2 }}>
                      <span className="text-sm" style={{ fontWeight: 600 }}>{p.goLive.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      <span className="text-xs mono" style={dateStyle}>{fmtRelDate(p.goLive, today)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="avatar-stack">
                      <Avatar person={p.pm} size="sm" />
                      <Avatar person={p.sa} size="sm" />
                      <Avatar person={p.sc} size="sm" />
                      {p.teamExtras.map(t => <Avatar key={t.id} person={t} size="sm" />)}
                    </div>
                  </td>
                  <td><button className="icon-btn"><Icon.More width={14} height={14} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, { ProjectsView, RAG, RAGCluster, PhasePill, CustChip, ProgressBar, fmtRelDate });
