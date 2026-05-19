import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { endpoints, type AuthConfig } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthProvider.js';

export function SignInPage() {
  const navigate = useNavigate();
  const { state } = useAuth();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
          <p className="signin-sub">Use your configured SSO provider to continue.</p>

          {err && <div className="signin-alert error">{err}</div>}

          {!config ? (
            <div className="signin-muted">Loading providers...</div>
          ) : config.providers.length === 0 ? (
            <div className="signin-alert neutral">
              No SSO providers configured. Set AUTH_PROVIDERS in the API env file.
            </div>
          ) : (
            <div className="signin-provider-list">
              {config.providers.map((p) => (
                <a key={p} href={`/api/auth/${p}`} className="btn-primary signin-provider-btn">
                  Sign in with {p === 'google' ? 'Google' : 'Okta'}
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
