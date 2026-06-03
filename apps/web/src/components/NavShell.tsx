import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { TopbarSearch } from './TopbarSearch.js';
import toriiLogo from '../assets/torii-logo.svg';

export function NavShell() {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const crumbLabel =
    location.pathname === '/'
      ? 'Dashboard'
      : location.pathname.startsWith('/projects/')
        ? 'Project detail'
        : location.pathname === '/people'
          ? 'People'
          : location.pathname.startsWith('/people/')
            ? 'Person detail'
            : location.pathname === '/customers'
          ? 'Customers'
          : location.pathname.startsWith('/customers/')
            ? 'Customer detail'
            : location.pathname === '/capacity'
              ? 'Team capacity'
              : location.pathname === '/risks'
                ? 'Risks'
                : location.pathname === '/timeline'
                  ? 'Timeline'
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
            to="/"
            end
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/timeline"
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            Timeline
          </NavLink>
          <NavLink
            to="/risks"
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            Risks
          </NavLink>
          <NavLink
            to="/customers"
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            Customers
          </NavLink>
          <NavLink
            to="/projects"
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            Projects
          </NavLink>
          <NavLink
            to="/people"
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            People
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
          <TopbarSearch />
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
