import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { configureApiClient } from '../api/client.js';
import { endpoints, type MeResponse } from '../api/endpoints.js';

const authBypassEnabled =
  import.meta.env.DEV &&
  import.meta.env.MODE !== 'test' &&
  import.meta.env.VITE_DISABLE_AUTH !== 'false';

const BYPASS_USER: NonNullable<MeResponse['user']> = {
  id: 'dev-auth-bypass',
  email: 'ux-preview@local.dev',
  name: 'UX Preview',
  role: 'PM',
  isAdmin: true,
};

interface AuthContextValue {
  state: 'loading' | 'authenticated' | 'unauthenticated';
  user: MeResponse['user'] | null;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<AuthContextValue['state']>(
    authBypassEnabled ? 'authenticated' : 'loading',
  );
  const [user, setUser] = useState<AuthContextValue['user']>(authBypassEnabled ? BYPASS_USER : null);

  useEffect(() => {
    if (authBypassEnabled) {
      configureApiClient({ onUnauthorized: () => undefined });
      return;
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
      if (authBypassEnabled) {
        setUser(BYPASS_USER);
        setState('authenticated');
        return;
      }

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
      if (authBypassEnabled) {
        navigate('/projects', { replace: true });
        return;
      }

      await endpoints.signout().catch(() => undefined);
      setUser(null);
      setState('unauthenticated');
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
