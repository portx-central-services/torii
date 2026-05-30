import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { endpoints, type AuthConfig } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthProvider.js';

const SIGNIN_ERRORS: Record<string, string> = {
  missing_state: 'Sign-in could not be completed (no state cookie). Please try again.',
  invalid_state: 'Sign-in state was invalid or expired. Please try again.',
  state_mismatch:
    'Sign-in state did not match the expected value. Please start a fresh sign-in.',
  token_exchange_failed:
    'Could not complete sign-in with the identity provider. Please try again.',
  forbidden:
    'Your account is not allowed to sign in to Torii. Contact an administrator if you believe this is wrong.',
};

export function SignInPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { state } = useAuth();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const signinErrorCode = params.get('signin_error');
  const signinErrorMessage = useMemo(
    () =>
      signinErrorCode ? SIGNIN_ERRORS[signinErrorCode] ?? 'Sign-in failed.' : null,
    [signinErrorCode],
  );

  useEffect(() => {
    if (state === 'authenticated') {
      navigate('/projects', { replace: true });
    }
  }, [state, navigate]);

  useEffect(() => {
    endpoints
      .authConfig()
      .then(setConfig)
      .catch(() => setErr('Unable to load sign-in providers.'));
  }, []);

  const keycloakEnabled = config?.providers.includes('keycloak') ?? false;

  return (
    <div className="signin-shell">
      <div className="signin-panel">
        <section className="signin-brand-col">
          <span className="overline">PortX Delivery Workspace</span>
          <h1>Torii</h1>
          <p>
            Delivery integration command center for project status, timeline health, and team capacity.
          </p>
          <ul className="signin-brand-list">
            <li>Portfolio and phase tracking</li>
            <li>Capacity and allocation drilldowns</li>
            <li>Tracker-linked sync workflows</li>
          </ul>
        </section>

        <section className="signin-auth-col">
          <h2>Sign in</h2>
          <p className="signin-sub">Sign in with your PortX SSO account.</p>

          {signinErrorMessage && (
            <div className="signin-alert error">
              <div>{signinErrorMessage}</div>
              {params.get('reason') && (
                <div className="text-xs mt-1 opacity-80">
                  Reason: {params.get('reason')}
                </div>
              )}
            </div>
          )}
          {err && <div className="signin-alert error">{err}</div>}

          {!config ? (
            <div className="signin-muted">Loading…</div>
          ) : !keycloakEnabled ? (
            <div className="signin-alert neutral">
              Sign-in is not configured. Set the <code>KEYCLOAK_*</code> env vars on the
              API and restart.
            </div>
          ) : (
            <a href="/api/auth/keycloak/login" className="btn-primary signin-provider-btn">
              Sign in with SSO
            </a>
          )}
        </section>
      </div>
    </div>
  );
}
