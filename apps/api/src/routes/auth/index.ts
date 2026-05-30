import type { FastifyInstance } from 'fastify';
import { generators } from 'openid-client';
import type { Env } from '../../env.js';
import type { DB } from '../../db.js';
import { buildSessionCookie } from '../../plugins/session.js';
import { getKeycloakClient, type KeycloakConfig } from './oidc-client.js';
import { handleSignin } from './handle-signin.js';

const PKCE_COOKIE = 'torii_pkce';

interface RegisterAuthOptions {
  db: DB;
  env: Env;
}

interface PkceCookieValue {
  codeVerifier: string;
  state: string;
}

function safeRedirect(env: Env, target: string): string {
  // Limit the post-sign-in redirect to our own web origin.
  try {
    const url = new URL(target, env.WEB_BASE_URL);
    if (url.origin !== new URL(env.WEB_BASE_URL).origin) return env.WEB_BASE_URL;
    return url.toString();
  } catch {
    return env.WEB_BASE_URL;
  }
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  opts: RegisterAuthOptions,
): Promise<void> {
  const { env, db } = opts;
  const enabled = Boolean(
    env.KEYCLOAK_ISSUER &&
      env.KEYCLOAK_CLIENT_ID &&
      env.KEYCLOAK_CLIENT_SECRET &&
      env.KEYCLOAK_REDIRECT_URI,
  );

  app.get('/api/auth/config', async () => ({
    providers: enabled ? ['keycloak'] : [],
  }));

  // Sign-out always works (clears local session/cookie) even if Keycloak isn't configured.
  app.post('/api/auth/signout', async (request, reply) => {
    const raw = request.cookies[env.SESSION_COOKIE_NAME];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        await db.session.delete({ where: { id: unsigned.value } }).catch(() => undefined);
      }
    }
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });

    if (!enabled) {
      return { ok: true, endSessionUrl: null };
    }
    const client = await getKeycloakClient({
      issuerUrl: env.KEYCLOAK_ISSUER,
      clientId: env.KEYCLOAK_CLIENT_ID,
      clientSecret: env.KEYCLOAK_CLIENT_SECRET,
      redirectUri: env.KEYCLOAK_REDIRECT_URI,
    }).catch(() => null);
    let endSessionUrl: string | null = null;
    if (client) {
      try {
        endSessionUrl = client.endSessionUrl({
          post_logout_redirect_uri: `${env.WEB_BASE_URL}/signin`,
        });
      } catch {
        endSessionUrl = null;
      }
    }
    return { ok: true, endSessionUrl };
  });

  if (!enabled) {
    if (env.NODE_ENV !== 'test') {
      app.log.warn(
        'Keycloak auth is not configured (KEYCLOAK_* env vars). /api/auth/keycloak/* routes are disabled.',
      );
    }
    return;
  }

  const kcConfig: KeycloakConfig = {
    issuerUrl: env.KEYCLOAK_ISSUER,
    clientId: env.KEYCLOAK_CLIENT_ID,
    clientSecret: env.KEYCLOAK_CLIENT_SECRET,
    redirectUri: env.KEYCLOAK_REDIRECT_URI,
  };

  app.get('/api/auth/keycloak/login', async (request, reply) => {
    const client = await getKeycloakClient(kcConfig);
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();
    const cookieValue: PkceCookieValue = { codeVerifier, state };

    reply.setCookie(PKCE_COOKIE, JSON.stringify(cookieValue), {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 10, // 10 minutes
      signed: true,
    });

    const url = client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    reply.redirect(url);
  });

  app.get('/api/auth/keycloak/callback', async (request, reply) => {
    const signinError = (code: string, log?: Record<string, unknown>) => {
      if (log) request.log.warn(log, `keycloak-callback:${code}`);
      const url = new URL('/signin', env.WEB_BASE_URL);
      url.searchParams.set('signin_error', code);
      // Surface a short reason hint so users don't need to scrape API logs.
      const reasonHint = typeof log?.reason === 'string' ? log.reason : null;
      if (reasonHint) url.searchParams.set('reason', reasonHint);
      reply.clearCookie(PKCE_COOKIE, { path: '/' });
      reply.redirect(url.toString());
    };

    const raw = request.cookies[PKCE_COOKIE];
    if (!raw) return signinError('missing_state');
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return signinError('invalid_state');

    let parsed: PkceCookieValue;
    try {
      parsed = JSON.parse(unsigned.value);
    } catch {
      return signinError('invalid_state');
    }

    reply.clearCookie(PKCE_COOKIE, { path: '/' });

    let claims: { email?: string; name?: string; email_verified?: boolean };
    try {
      const client = await getKeycloakClient(kcConfig);
      const params = client.callbackParams(request.raw);
      if (params.state !== parsed.state) {
        return signinError('state_mismatch');
      }
      const tokenSet = await client.callback(kcConfig.redirectUri, params, {
        state: parsed.state,
        code_verifier: parsed.codeVerifier,
      });
      const idClaims = tokenSet.claims();
      claims = {
        email: idClaims.email as string | undefined,
        name: idClaims.name as string | undefined,
        email_verified: idClaims.email_verified as boolean | undefined,
      };
    } catch (err) {
      return signinError('token_exchange_failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    const result = await handleSignin(
      {
        email: claims.email ?? '',
        name: claims.name,
        email_verified: claims.email_verified,
      },
      {
        db,
        allowedDomains: env.ALLOWED_EMAIL_DOMAINS,
        adminEmails: env.ADMIN_EMAILS,
      },
    );

    if (result.status === 'forbidden') {
      return signinError('forbidden', { reason: result.reason });
    }

    const cookie = buildSessionCookie(result.sessionId);
    reply.setCookie(env.SESSION_COOKIE_NAME, cookie.value, cookie.options);
    reply.redirect(safeRedirect(env, env.WEB_BASE_URL));
  });

}
