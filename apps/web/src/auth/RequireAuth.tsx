import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider.js';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  useEffect(() => {
    /* nothing — placeholder for analytics */
  }, [state]);

  if (state === 'loading') {
    return <div className="p-8 text-gray-500">Loading…</div>;
  }
  if (state === 'unauthenticated') {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { state, user } = useAuth();
  if (state === 'loading') return <div className="p-8 text-gray-500">Loading…</div>;
  if (state === 'unauthenticated') return <Navigate to="/signin" replace />;
  if (!user?.isAdmin) {
    return (
      <div className="p-8 text-red-700">You don’t have permission to view this page.</div>
    );
  }
  return <>{children}</>;
}
