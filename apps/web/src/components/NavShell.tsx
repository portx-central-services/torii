import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';

export function NavShell() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="font-semibold text-lg text-torii">Torii</div>
            <nav className="flex items-center gap-1">
              <NavLink
                to="/projects"
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded text-sm ${isActive ? 'bg-torii-muted text-torii' : 'text-gray-700 hover:bg-gray-100'}`
                }
              >
                Projects
              </NavLink>
              <NavLink
                to="/capacity"
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded text-sm ${isActive ? 'bg-torii-muted text-torii' : 'text-gray-700 hover:bg-gray-100'}`
                }
              >
                Capacity
              </NavLink>
              {user?.isAdmin && (
                <NavLink
                  to="/trackers"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded text-sm ${isActive ? 'bg-torii-muted text-torii' : 'text-gray-700 hover:bg-gray-100'}`
                  }
                >
                  Trackers
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="text-sm text-gray-600">
                <span className="font-medium text-gray-800">{user.name}</span>
                <span className="ml-2 badge bg-gray-100 text-gray-700">{user.role}</span>
              </div>
            )}
            <button type="button" className="btn-secondary" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
