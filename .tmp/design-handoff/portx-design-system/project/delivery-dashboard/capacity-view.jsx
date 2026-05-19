/* Capacity view — team capacity with per-person drilldown */

function CapacityBar({ pct, status }) {
  const cls = 'cap-bar cap-status-' + status;
  const capped = Math.min(120, pct);
  return (
    <div className={cls}>
      <span style={{ width: capped + '%' }} />
      <span className="marker-100" />
    </div>
  );
}

function CapacityView({ team, projects, allocations, teamSummary, helpers }) {
  const [selectedId, setSelectedId] = React.useState(team[0].id);
  const [roleFilter, setRoleFilter] = React.useState('all');
  const [sortBy, setSortBy] = React.useState('alloc');

  const visible = React.useMemo(() => {
    let list = team.slice();
    if (roleFilter !== 'all') list = list.filter(t => t.role === roleFilter);
    if (sortBy === 'alloc') list.sort((a, b) => b.allocatedPct - a.allocatedPct);
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'role') list.sort((a, b) => a.role.localeCompare(b.role) || b.allocatedPct - a.allocatedPct);
    return list;
  }, [team, roleFilter, sortBy]);

  const selected = team.find(t => t.id === selectedId);
  const selectedAllocs = selected ? allocations[selected.id] : [];
  const selectedProjects = selectedAllocs.map(a => ({
    ...a,
    project: projects.find(p => p.id === a.projectId),
  }));

  // Cap visualization colors for stacked bar
  const projectColors = (i) => {
    const palette = ['#00C9E4', '#02E4A0', '#00DF99', '#A7EEF6', '#3FD8EA', '#3DECB6', '#02B07C', '#0EA5E9'];
    return palette[i % palette.length];
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-header-title">
          <span className="overline">Delivery Team · Week of May 11, 2026</span>
          <h1>Team Capacity</h1>
          <div className="page-sub">{teamSummary.total} people · avg allocation {teamSummary.avgAllocation}% · click any row to drill into their week</div>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-ghost"><Icon.Download width={14} height={14} />Export</button>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi accent">
          <div className="kpi-label">Avg allocation</div>
          <div className="kpi-value">{teamSummary.avgAllocation}%</div>
          <div className="kpi-sub">across {teamSummary.total} people</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Over-allocated</div>
          <div className="kpi-value" style={{ color: 'var(--status-danger)' }}>{teamSummary.over}</div>
          <div className="kpi-sub">people ≥ 100%</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">High utilization</div>
          <div className="kpi-value" style={{ color: 'var(--status-warning)' }}>{teamSummary.high}</div>
          <div className="kpi-sub">85–99% allocated</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Bench / available</div>
          <div className="kpi-value">{teamSummary.bench + teamSummary.low}</div>
          <div className="kpi-sub">{teamSummary.bench} unassigned, {teamSummary.low} {'<'} 50%</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Roles</div>
          <div className="kpi-value" style={{ fontSize: 20, display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span>{teamSummary.byRole.PM}<span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 3 }}>PM</span></span>
            <span>{teamSummary.byRole.SA}<span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 3 }}>SA</span></span>
            <span>{teamSummary.byRole.SC}<span style={{ fontSize: 11, color: 'var(--fg-muted)', marginLeft: 3 }}>SC</span></span>
          </div>
          <div className="kpi-sub">PMs · architects · consultants</div>
        </div>
      </div>

      <div className="filter-row">
        <div className="segmented">
          {[
            { k: 'all', l: 'All roles' },
            { k: 'PM',  l: 'Project Managers' },
            { k: 'SA',  l: 'Solution Architects' },
            { k: 'SC',  l: 'Solution Consultants' },
          ].map(o => (
            <button key={o.k} className={roleFilter === o.k ? 'on' : ''} onClick={() => setRoleFilter(o.k)}>{o.l}</button>
          ))}
        </div>
        <div className="row gap-2" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--fg-muted)' }}>
          <span>Sort:</span>
          <div className="segmented">
            {[
              { k: 'alloc', l: 'Allocation' },
              { k: 'name',  l: 'Name' },
              { k: 'role',  l: 'Role' },
            ].map(o => (
              <button key={o.k} className={sortBy === o.k ? 'on' : ''} onClick={() => setSortBy(o.k)}>{o.l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="capacity-grid">
        <div className="card">
          {visible.map(person => {
            const status = helpers.capacityStatus(person.allocatedPct);
            const isSelected = person.id === selectedId;
            return (
              <div
                key={person.id}
                className={'cap-row' + (isSelected ? ' selected' : '')}
                onClick={() => setSelectedId(person.id)}
              >
                <div className="row gap-2" style={{ minWidth: 0 }}>
                  <Avatar person={person} size="sm" />
                  <div className="col" style={{ gap: 2, minWidth: 0 }}>
                    <span className="text-sm" style={{ fontWeight: 600 }}>{person.name}</span>
                    <span className="row gap-2" style={{ gap: 6 }}>
                      <RolePill role={person.role} />
                      <span className="text-xs muted">{person.projectsAssigned} {person.projectsAssigned === 1 ? 'project' : 'projects'}</span>
                    </span>
                  </div>
                </div>
                <div className="cap-bar-wrap">
                  <CapacityBar pct={person.allocatedPct} status={status} />
                </div>
                <div className={'cap-pct ' + (status === 'over' ? 'over' : status === 'high' ? 'high' : status === 'bench' ? 'bench' : '')}>
                  {person.allocatedPct}%
                </div>
              </div>
            );
          })}
        </div>

        <div className="drilldown">
          {!selected ? (
            <div className="drilldown-empty">Click a row to see allocation detail.</div>
          ) : (
            <>
              <div className="drilldown-head">
                <Avatar person={selected} size="lg" />
                <div className="col" style={{ gap: 4, flex: 1 }}>
                  <div className="drilldown-name">{selected.name}</div>
                  <div className="row gap-2" style={{ gap: 6 }}>
                    <RolePill role={selected.role} />
                    <span className="drilldown-role">
                      {selected.role === 'PM' ? 'Project Manager' : selected.role === 'SA' ? 'Solution Architect' : 'Solution Consultant'}
                    </span>
                    <span className="text-xs muted">· started {new Date(selected.startedAt).getFullYear()}</span>
                  </div>
                </div>
                <button className="btn btn-ghost"><Icon.ExternalLink width={14} height={14} />Profile</button>
              </div>

              <div className="drilldown-stats">
                <div className="drilldown-stat">
                  <div className="drilldown-stat-label">This week</div>
                  <div className="drilldown-stat-value" style={{
                    color: selected.allocatedPct >= 100 ? 'var(--status-danger)' : selected.allocatedPct >= 85 ? 'var(--status-warning)' : 'var(--fg-default)'
                  }}>
                    {selected.allocatedPct}%
                  </div>
                  <div className="text-xs muted">{Math.round(selected.allocatedPct * 0.4)} of 40 hrs</div>
                </div>
                <div className="drilldown-stat">
                  <div className="drilldown-stat-label">Active projects</div>
                  <div className="drilldown-stat-value">{selectedProjects.length}</div>
                  <div className="text-xs muted">across portfolio</div>
                </div>
              </div>

              <div className="overline" style={{ marginBottom: 8 }}>Allocation breakdown</div>
              <div className="alloc-bar-stacked">
                {selectedProjects.map((sp, i) => (
                  <div key={sp.projectId} style={{
                    width: Math.min(100, sp.pct) + '%',
                    background: projectColors(i),
                    minWidth: sp.pct > 8 ? 'auto' : '0',
                  }}>
                    {sp.pct > 12 ? sp.pct + '%' : ''}
                  </div>
                ))}
                {selected.allocatedPct < 100 ? (
                  <div style={{
                    flex: 1, background: 'transparent', color: 'var(--fg-muted)',
                    fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center',
                  }}>
                    {100 - selected.allocatedPct < 12 ? '' : (100 - selected.allocatedPct) + '% free'}
                  </div>
                ) : null}
              </div>
              <div className="text-xs muted mt-2" style={{ marginBottom: 14 }}>
                Stacked %: each segment is one project. Marker at 100% is full week.
              </div>

              <div className="alloc-list">
                {selectedProjects.map((sp, i) => (
                  <div key={sp.projectId} className="alloc-row">
                    <div className="alloc-dot" style={{ background: projectColors(i) }} />
                    <div className="alloc-name col" style={{ gap: 1 }}>
                      <span style={{ fontWeight: 600 }}>{sp.project.shortName}</span>
                      <span className="text-xs muted">{sp.project.phase.label} · {sp.project.id}</span>
                    </div>
                    <div className="row gap-2">
                      <RAG value={helpers.worstHealth(sp.project.health)} />
                      <span className="alloc-pct">{sp.pct}%</span>
                    </div>
                  </div>
                ))}
                {selectedProjects.length === 0 ? (
                  <div className="text-xs muted" style={{ textAlign: 'center', padding: 14 }}>
                    On the bench. Available for new work.
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CapacityView });
