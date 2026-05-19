/* Dashboard shell — Sidebar + Topbar */

function Avatar({ person, size = 'md', className = '' }) {
  const cls = size === 'sm' ? 'avatar avatar-sm' : size === 'lg' ? 'avatar avatar-lg' : 'avatar';
  return (
    <div
      className={cls + ' ' + className}
      style={{ background: person.tone || 'var(--portx-gradient)' }}
      title={person.name}
    >
      {person.initials}
    </div>
  );
}

function RolePill({ role }) {
  return <span className={'role-pill ' + role}>{role}</span>;
}

function PersonRow({ person, withRole = true, size = 'md' }) {
  return (
    <div className="person-row">
      <Avatar person={person} size={size} />
      <span className="name">{person.name}</span>
      {withRole ? <RolePill role={person.role} /> : null}
    </div>
  );
}

function Sidebar({ route, setRoute, portfolio }) {
  const navItems = [
    { key: 'projects', label: 'Projects',  icon: Icon.Projects, badge: portfolio.total },
    { key: 'capacity', label: 'Capacity',  icon: Icon.Capacity },
    { key: 'roadmap',  label: 'Roadmap',   icon: Icon.Calendar, disabled: true },
    { key: 'reports',  label: 'Reports',   icon: Icon.Reports,  disabled: true },
  ];
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src="../assets/logos/portx-horizontal-onDark.svg" alt="PortX" />
        <span className="sidebar-brand-suffix">Delivery</span>
      </div>

      <div className="sidebar-section-label">Workspace</div>
      <nav className="sidebar-nav">
        {navItems.map(item => {
          const isActive = route.view === item.key;
          return (
            <button
              key={item.key}
              className={'sidebar-nav-item' + (isActive ? ' active' : '')}
              onClick={() => !item.disabled && setRoute({ view: item.key })}
              style={item.disabled ? { opacity: 0.4, cursor: 'not-allowed' } : null}
            >
              <item.icon className="nav-icon" />
              <span>{item.label}</span>
              {item.badge != null ? <span className="nav-badge">{item.badge}</span> : null}
              {item.disabled ? <span className="nav-badge">soon</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-section-label">Filters</div>
      <nav className="sidebar-nav">
        <button className="sidebar-nav-item">
          <Icon.Box className="nav-icon" />
          <span>My projects</span>
          <span className="nav-badge">7</span>
        </button>
        <button className="sidebar-nav-item">
          <Icon.Layers className="nav-icon" />
          <span>Going live ≤ 60d</span>
          <span className="nav-badge">{portfolio.goingLiveSoon}</span>
        </button>
        <button className="sidebar-nav-item" style={{ color: 'var(--status-warning)' }}>
          <Icon.Sparkles className="nav-icon" />
          <span>At risk</span>
          <span className="nav-badge">{portfolio.atRisk + portfolio.blocked}</span>
        </button>
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-foot-avatar">RH</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sidebar-foot-name">Ryan Haning</div>
          <div className="sidebar-foot-role">Delivery Lead · PortX</div>
        </div>
        <button className="icon-btn" style={{ color: 'var(--ink-400)' }}>
          <Icon.Settings />
        </button>
      </div>
    </aside>
  );
}

function Topbar({ route, setRoute }) {
  const crumbs = [];
  if (route.view === 'projects') crumbs.push({ label: 'Projects', onClick: () => setRoute({ view: 'projects' }) });
  if (route.view === 'capacity') crumbs.push({ label: 'Team Capacity' });
  if (route.view === 'project-detail') {
    crumbs.push({ label: 'Projects', onClick: () => setRoute({ view: 'projects' }) });
    crumbs.push({ label: route.projectId });
  }
  return (
    <header className="topbar">
      <div className="row gap-2" style={{ fontSize: 13, color: 'var(--fg-muted)' }}>
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <Icon.ChevronRight width={14} height={14} style={{ opacity: 0.5 }} /> : null}
            {c.onClick
              ? <button onClick={c.onClick} style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>{c.label}</button>
              : <span style={{ color: 'var(--fg-default)', fontWeight: 600 }}>{c.label}</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-search">
        <Icon.Search width={14} height={14} />
        <input placeholder="Search projects, customers, people…" />
        <kbd>⌘K</kbd>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn"><Icon.Help /></button>
        <button className="icon-btn"><Icon.Bell /></button>
        <button className="btn btn-primary"><Icon.Plus width={14} height={14} />New project</button>
      </div>
    </header>
  );
}

Object.assign(window, { Sidebar, Topbar, Avatar, PersonRow, RolePill });
