/* Project Detail view — Gantt, integrations, GitHub, artifacts, team, burnup */

function GanttChart({ project, today }) {
  // Calculate the timeline range, with a small buffer on either side
  const earliest = project.milestones[0].start;
  const latest = project.milestones[project.milestones.length - 1].end;
  const totalMs = latest - earliest;
  const pctOf = (d) => ((d - earliest) / totalMs) * 100;

  // Group milestones in pairs so each "row" has a couple of phases
  // Actually just render one row per phase to keep it readable.
  return (
    <div className="gantt">
      {project.milestones.map(m => {
        const left = Math.max(0, pctOf(m.start));
        const right = Math.min(100, pctOf(m.end));
        const width = Math.max(2, right - left);
        const todayPct = pctOf(today);
        const inWindow = todayPct >= 0 && todayPct <= 100;
        return (
          <React.Fragment key={m.phase.key}>
            <div className="gantt-label">{m.phase.label}</div>
            <div className="gantt-track">
              <div className={'gantt-bar ' + m.status} style={{ left: left + '%', width: width + '%' }}>
                {m.phase.short}
              </div>
              {inWindow && m.status === 'active' ? (
                <div className="gantt-today" style={{ left: todayPct + '%' }} />
              ) : null}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function BurnupChart({ burnup }) {
  // SVG-based — paths for plan, scope, actual
  const W = 600, H = 180, PAD_L = 32, PAD_B = 24, PAD_T = 12, PAD_R = 12;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_B - PAD_T;
  const maxY = Math.max(...burnup.map(b => Math.max(b.plan, b.scope, b.actual || 0))) * 1.1;
  const x = (i) => PAD_L + (i / (burnup.length - 1)) * innerW;
  const y = (v) => PAD_T + innerH - (v / maxY) * innerH;

  const pathFrom = (key) => {
    let d = '';
    burnup.forEach((b, i) => {
      const v = b[key];
      if (v == null) return;
      d += (d ? ' L' : 'M') + x(i) + ' ' + y(v);
    });
    return d;
  };

  // Area under actual for that filled feel
  const actualPoints = burnup.filter(b => b.actual != null);
  let areaPath = '';
  if (actualPoints.length) {
    areaPath = 'M' + x(0) + ' ' + y(0);
    actualPoints.forEach((b, i) => { areaPath += ' L' + x(i) + ' ' + y(b.actual); });
    areaPath += ' L' + x(actualPoints.length - 1) + ' ' + y(0) + ' Z';
  }

  // Y-axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => ({ v: Math.round(maxY * t / 100) * 100, y: PAD_T + innerH - t * innerH }));

  return (
    <div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none">
          <defs>
            <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#02E4A0" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#00C9E4" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="actualStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00C9E4" />
              <stop offset="100%" stopColor="#02E4A0" />
            </linearGradient>
          </defs>
          {/* gridlines */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={t.y} y2={t.y} stroke="#E8ECF1" strokeWidth="1" />
              <text x={PAD_L - 6} y={t.y + 3} fontSize="9" fontFamily="JetBrains Mono" fill="#8A93A1" textAnchor="end">
                {t.v}
              </text>
            </g>
          ))}
          {/* x-axis labels */}
          {burnup.map((b, i) => i % Math.ceil(burnup.length / 8) === 0 || i === burnup.length - 1 ? (
            <text key={i} x={x(i)} y={H - 6} fontSize="9" fontFamily="JetBrains Mono" fill="#8A93A1" textAnchor="middle">
              W{b.week}
            </text>
          ) : null)}
          {/* scope line (dashed) */}
          <path d={pathFrom('scope')} fill="none" stroke="#5B6675" strokeWidth="1.5" strokeDasharray="4 4" />
          {/* plan line */}
          <path d={pathFrom('plan')} fill="none" stroke="#B3BAC5" strokeWidth="1.5" />
          {/* actual */}
          <path d={areaPath} fill="url(#actualFill)" />
          <path d={pathFrom('actual')} fill="none" stroke="url(#actualStroke)" strokeWidth="2.5" />
          {/* actual point */}
          {actualPoints.length ? (
            <circle cx={x(actualPoints.length - 1)} cy={y(actualPoints[actualPoints.length - 1].actual)} r="4" fill="#02E4A0" stroke="white" strokeWidth="2" />
          ) : null}
        </svg>
      </div>
      <div className="chart-legend">
        <span className="chart-legend-key"><span className="chart-legend-swatch" style={{ background: 'var(--portx-gradient)' }} />Actual hours</span>
        <span className="chart-legend-key"><span className="chart-legend-swatch" style={{ background: '#B3BAC5' }} />Plan</span>
        <span className="chart-legend-key"><span className="chart-legend-swatch" style={{ background: '#5B6675', borderTop: '1px dashed' }} />Scope</span>
      </div>
    </div>
  );
}

function IntegrationList({ integrations }) {
  return (
    <div className="int-list">
      {integrations.map((it, i) => (
        <div key={i} className="int-row">
          <div className="row gap-2" style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: it.cat === 'Banking Core' ? 'var(--portx-gradient)' : 'var(--ink-100)',
              color: it.cat === 'Banking Core' ? 'var(--ink-1000)' : 'var(--fg-muted)',
              display: 'grid', placeItems: 'center',
              fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
            }}>
              {it.cat === 'Banking Core' ? 'C' : it.cat[0]}
            </div>
            <div className="col" style={{ minWidth: 0, gap: 0 }}>
              <span className="int-name">{it.name}</span>
              <span className="int-cat">{it.cat}</span>
            </div>
          </div>
          <span className={'int-status ' + it.status}>{it.status.replace('-', ' ')}</span>
        </div>
      ))}
    </div>
  );
}

function GithubFeed({ items, today }) {
  return (
    <div className="gh-feed">
      {items.slice(0, 8).map((it, i) => (
        <div key={i} className="gh-item">
          <Avatar person={it.actor} size="sm" />
          <div className="gh-body">
            <span className="actor">{it.actor.name}</span>{' '}
            <span className="verb">{it.verb}</span>{' '}
            <span className="target">{it.target}</span>
            {it.verb.includes('PR') || it.verb.includes('push') || it.verb.includes('deployed') ? (
              <span className="mono text-xs muted" style={{ marginLeft: 6 }}>{it.sha}</span>
            ) : null}
          </div>
          <div className="gh-time">{fmtRelDate(it.when, today)}</div>
        </div>
      ))}
    </div>
  );
}

function ArtifactGrid({ artifacts }) {
  return (
    <div className="artifact-grid">
      {artifacts.map((a, i) => (
        <div key={i} className="artifact">
          <div className="artifact-icon">{a.icon}</div>
          <div className="artifact-body">
            <div className="artifact-name">
              {a.type}
              <span className="artifact-tag">{a.tag}</span>
            </div>
            <div className="artifact-meta">Updated by {a.updatedBy.name.split(' ')[0]} · {a.updatedAt.toLocaleString('en-US', { month: 'short', day: 'numeric' })}</div>
          </div>
          <Icon.ExternalLink width={14} height={14} style={{ color: 'var(--fg-subtle)' }} />
        </div>
      ))}
    </div>
  );
}

function TeamRoster({ project, allocations }) {
  const members = [
    project.pm, project.sa, project.sc, ...project.teamExtras,
  ];
  return (
    <div className="roster">
      {members.map((m, i) => {
        const alloc = (allocations[m.id] || []).find(a => a.projectId === project.id);
        return (
          <div key={m.id + i} className="roster-row">
            <Avatar person={m} />
            <div className="roster-info">
              <div className="roster-name row gap-2">{m.name} <RolePill role={m.role} /></div>
              <div className="roster-role">{m.role === 'PM' ? 'Project Manager' : m.role === 'SA' ? 'Solution Architect' : 'Solution Consultant'}</div>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
              <span className="roster-alloc">{alloc ? alloc.pct + '%' : '—'}</span>
              <span className="text-xs muted">on this project</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectDetail({ project, today, helpers, allocations, setRoute }) {
  if (!project) {
    return <div className="page"><div className="empty">Project not found.</div></div>;
  }
  const worst = helpers.worstHealth(project.health);
  const daysToLive = Math.round((project.goLive - today) / 86400000);

  return (
    <div className="page">
      <div className="row gap-2">
        <button className="btn btn-ghost" onClick={() => setRoute({ view: 'projects' })}>
          <Icon.ArrowLeft width={14} height={14} />Back to portfolio
        </button>
      </div>

      <div className="detail-hero">
        <div className="detail-hero-row">
          <div className="detail-hero-title">
            <div className="row gap-2">
              <span className="id">{project.id}</span>
              <CustChip type={project.customerType} />
              <span className="mono text-xs muted">{project.core}</span>
            </div>
            <h1>{project.shortName}</h1>
            <div className="desc">{project.description}</div>
          </div>
          <div className="col" style={{ alignItems: 'flex-end', gap: 8 }}>
            <div className="row gap-2"><RAG value={worst} /> <span className="text-sm" style={{ fontWeight: 600 }}>{worst === 'green' ? 'On track' : worst === 'amber' ? 'At risk' : 'Blocked'}</span></div>
            <RAGCluster health={project.health} />
            <button className="btn btn-primary mt-2"><Icon.Sparkles width={14} height={14} />Status update with PiXi</button>
          </div>
        </div>
        <div className="hero-stat-grid">
          <div className="hero-stat">
            <div className="hero-stat-label">Phase</div>
            <div className="hero-stat-value">{project.phase.label}</div>
            <div className="text-xs muted">{project.phaseIndex + 1} of 10</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-label">Progress</div>
            <div className="hero-stat-value">{project.progress}%</div>
            <ProgressBar pct={project.progress} />
          </div>
          <div className="hero-stat">
            <div className="hero-stat-label">Target go-live</div>
            <div className="hero-stat-value">{project.goLive.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
            <div className="text-xs muted">{fmtRelDate(project.goLive, today)} · kicked off {fmtRelDate(project.kickoff, today)}</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-label">Effort</div>
            <div className="hero-stat-value">{project.actualHrs} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>/ {project.estimatedHrs}h</span></div>
            <div className="text-xs muted">{Math.round((project.actualHrs / project.estimatedHrs) * 100)}% of estimate consumed</div>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="col gap-3">
          <div className="section-card">
            <div className="section-card-head">
              <h3>Phase timeline</h3>
              <span className="text-xs muted">{project.kickoff.toLocaleString('en-US', { month: 'short', year: 'numeric' })} → {project.goLive.toLocaleString('en-US', { month: 'short', year: 'numeric' })}</span>
            </div>
            <GanttChart project={project} today={today} />
          </div>

          <div className="section-card">
            <div className="section-card-head">
              <h3>Burn-up · effort vs. estimate</h3>
              <span className="text-xs muted">Weekly · {project.burnup.length} weeks</span>
            </div>
            <BurnupChart burnup={project.burnup} />
          </div>

          <div className="section-card">
            <div className="section-card-head">
              <h3 className="row gap-2"><Icon.Github width={16} height={16} />Recent GitHub activity</h3>
              <span className="more">View repo →</span>
            </div>
            <GithubFeed items={project.github} today={today} />
          </div>
        </div>

        <div className="col gap-3">
          <div className="section-card">
            <div className="section-card-head">
              <h3>Integrations in scope</h3>
              <span className="text-xs muted">{project.integrations.filter(i => i.status === 'done').length}/{project.integrations.length} live</span>
            </div>
            <IntegrationList integrations={project.integrations} />
          </div>

          <div className="section-card">
            <div className="section-card-head">
              <h3>Team roster</h3>
            </div>
            <TeamRoster project={project} allocations={allocations} />
          </div>

          <div className="section-card">
            <div className="section-card-head">
              <h3>Linked artifacts</h3>
              <span className="more">+ Add</span>
            </div>
            <ArtifactGrid artifacts={project.artifacts} />
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ProjectDetail, GanttChart, BurnupChart, IntegrationList, GithubFeed, ArtifactGrid, TeamRoster });
