import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import toriiLogo from '../assets/torii-logo.svg';

export function NavShell() {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const crumbLabel =
    location.pathname.startsWith('/projects/')
      ? 'Project detail'
      : location.pathname === '/capacity'
        ? 'Team capacity'
        : location.pathname === '/trackers'
          ? 'Trackers'
          : 'Projects';

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-brand-wrap">
          <img src={toriiLogo} alt="Torii" className="sidebar-logo" />
        </div>

        <nav className="sidebar-nav">
          <NavLink
            to="/projects"
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            Projects
          </NavLink>
          <NavLink
            to="/capacity"
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            Capacity
          </NavLink>
          {user?.isAdmin && (
            <NavLink
              to="/trackers"
              className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
            >
              Trackers
            </NavLink>
          )}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-foot-avatar">
            {(user?.name ?? 'UX')
              .split(' ')
              .slice(0, 2)
              .map((p) => p[0])
              .join('')
              .toUpperCase()}
          </div>
          <div className="sidebar-foot-user">
            <div className="sidebar-foot-name">{user?.name ?? 'UX Preview'}</div>
            <div className="sidebar-foot-role">{user?.role ?? 'PM'}</div>
          </div>
          <button type="button" className="btn-ghost sidebar-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <section className="app-main">
        <header className="topbar">
          <div className="topbar-crumbs">
            <span>Workspace</span>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{crumbLabel}</span>
          </div>
          <label className="topbar-search">
            <span>Search</span>
            <input placeholder="Projects, customers, people" />
          </label>
          <div className="topbar-actions">
            <NavLink to="/projects" className="btn-secondary">
              Portfolio
            </NavLink>
            <NavLink to="/projects" className="btn-primary">
              New project
            </NavLink>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </section>
    </div>
  );
}
