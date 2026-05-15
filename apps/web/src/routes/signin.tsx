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
      .catch(() => setErr('Could not load sign-in providers'));
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-semibold text-torii text-center mb-1">Torii</h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          Project Delivery Management Gateway
        </p>
        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 mb-4">
            {err}
          </div>
        )}
        {!config ? (
          <div className="text-sm text-gray-500 text-center">Loading providers…</div>
        ) : config.providers.length === 0 ? (
          <div className="text-sm text-gray-700 text-center">
            No SSO providers configured. See <code>AUTH_PROVIDERS</code> in <code>.env</code>.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {config.providers.map((p) => (
              <a key={p} href={`/api/auth/${p}`} className="btn-primary w-full justify-center">
                Sign in with {p === 'google' ? 'Google' : 'Okta'}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
