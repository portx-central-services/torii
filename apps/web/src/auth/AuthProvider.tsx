import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { configureApiClient } from '../api/client.js';
import { endpoints, type MeResponse } from '../api/endpoints.js';

// Dev-only synthetic admin session. Opt-in: requires the explicit flag AND a dev build,
// AND the API to also opt in (ENABLE_PREVIEW_ADMIN_BYPASS=true). When only one side
// enables it, `/api/me` will report unauthenticated and the user lands on /signin.
const authBypassEnabled =
  import.meta.env.DEV &&
  import.meta.env.MODE !== 'test' &&
  import.meta.env.VITE_DISABLE_AUTH === 'true';

const PREVIEW_ADMIN_COOKIE = 'torii_preview_admin';
const PREVIEW_ADMIN_COOKIE_VALUE = '1';

interface AuthContextValue {
  state: 'loading' | 'authenticated' | 'unauthenticated';
  user: MeResponse['user'] | null;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<AuthContextValue['state']>('loading');
  const [user, setUser] = useState<AuthContextValue['user']>(null);

  useEffect(() => {
    if (authBypassEnabled) {
      // Tell the API to honor the bypass on subsequent requests; /api/me decides whether
      // we actually end up authenticated (it depends on the API's own flag).
      document.cookie = `${PREVIEW_ADMIN_COOKIE}=${PREVIEW_ADMIN_COOKIE_VALUE}; Path=/; SameSite=Lax`;
    } else {
      document.cookie = `${PREVIEW_ADMIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    }

    configureApiClient({
      onUnauthorized: () => {
        setState('unauthenticated');
        setUser(null);
        if (window.location.pathname !== '/signin') {
          navigate('/signin', { replace: true });
        }
      },
    });
  }, [navigate]);

  const reload = useMemo(
    () => async () => {
      try {
        const me = await endpoints.me();
        if (me.authenticated && me.user) {
          setUser(me.user);
          setState('authenticated');
        } else {
          setUser(null);
          setState('unauthenticated');
        }
      } catch {
        setUser(null);
        setState('unauthenticated');
      }
    },
    [],
  );

  const signOut = useMemo(
    () => async () => {
      const result = await endpoints.signout().catch(() => null);
      // Clear any preview-admin cookie so a half-stale dev bypass doesn't leak in.
      document.cookie = `${PREVIEW_ADMIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      setUser(null);
      setState('unauthenticated');
      // If the API returned a Keycloak end-session URL, navigate there so the IdP
      // session ends too. Keycloak then redirects back to `/signin`.
      if (result?.endSessionUrl) {
        window.location.assign(result.endSessionUrl);
        return;
      }
      navigate('/signin', { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const value: AuthContextValue = { state, user, reload, signOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function useIsPM(): boolean {
  return useAuth().user?.role === 'PM';
}

export function useIsAdmin(): boolean {
  return useAuth().user?.isAdmin === true;
}
