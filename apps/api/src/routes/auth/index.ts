import type { FastifyInstance } from 'fastify';
import { generators } from 'openid-client';
import type { Env } from '../../env.js';
import type { DB } from '../../db.js';
import { buildSessionCookie } from '../../plugins/session.js';
import { ValidationError, ForbiddenError } from '@torii/shared';
import { getOidcClient, type OidcProviderConfig } from './oidc-client.js';
import { handleSignin } from './handle-signin.js';

const PKCE_COOKIE = 'torii_pkce';

interface RegisterAuthOptions {
  db: DB;
  env: Env;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  opts: RegisterAuthOptions,
): Promise<void> {
  const { env, db } = opts;
  const providers: OidcProviderConfig[] = [];

  if (env.AUTH_PROVIDERS.includes('google')) {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
      app.log.warn('Google enabled in AUTH_PROVIDERS but config is incomplete; skipping');
    } else {
      providers.push({
        name: 'google',
        issuerUrl: 'https://accounts.google.com',
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: env.GOOGLE_REDIRECT_URI,
      });
    }
  }

  if (env.AUTH_PROVIDERS.includes('okta')) {
    if (
      !env.OKTA_ISSUER ||
      !env.OKTA_CLIENT_ID ||
      !env.OKTA_CLIENT_SECRET ||
      !env.OKTA_REDIRECT_URI
    ) {
      app.log.warn('Okta enabled in AUTH_PROVIDERS but config is incomplete; skipping');
    } else {
      providers.push({
        name: 'okta',
        issuerUrl: env.OKTA_ISSUER,
        clientId: env.OKTA_CLIENT_ID,
        clientSecret: env.OKTA_CLIENT_SECRET,
        redirectUri: env.OKTA_REDIRECT_URI,
      });
    }
  }

  app.get('/api/auth/config', async () => ({
    providers: providers.map((p) => p.name),
  }));

  for (const provider of providers) {
    app.get(`/api/auth/${provider.name}`, async (request, reply) => {
      const client = await getOidcClient(provider);
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);
      const state = generators.state();

      reply.setCookie(
        PKCE_COOKIE,
        JSON.stringify({ codeVerifier, state, provider: provider.name }),
        {
          httpOnly: true,
          sameSite: 'lax',
          secure: env.NODE_ENV === 'production',
          path: '/',
          maxAge: 60 * 10, // 10 minutes
          signed: true,
        },
      );

      const url = client.authorizationUrl({
        scope: 'openid email profile',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      });
      reply.redirect(url);
    });

    app.get(`/api/auth/${provider.name}/callback`, async (request, reply) => {
      const raw = request.cookies[PKCE_COOKIE];
      if (!raw) throw new ValidationError('Missing PKCE cookie');
      const unsigned = request.unsignCookie(raw);
      if (!unsigned.valid || !unsigned.value) throw new ValidationError('Invalid PKCE cookie');

      let parsed: { codeVerifier: string; state: string; provider: string };
      try {
        parsed = JSON.parse(unsigned.value);
      } catch {
        throw new ValidationError('Malformed PKCE cookie');
      }
      if (parsed.provider !== provider.name) {
        throw new ValidationError('PKCE cookie provider mismatch');
      }

      reply.clearCookie(PKCE_COOKIE, { path: '/' });

      const client = await getOidcClient(provider);
      const params = client.callbackParams(request.raw);
      const tokenSet = await client.callback(provider.redirectUri, params, {
        state: parsed.state,
        code_verifier: parsed.codeVerifier,
      });
      const claims = tokenSet.claims();

      const result = await handleSignin(
        {
          email: claims.email as string,
          name: claims.name as string | undefined,
          email_verified: claims.email_verified as boolean | undefined,
        },
        { db, allowedDomains: env.ALLOWED_EMAIL_DOMAINS },
      );

      if (result.status === 'forbidden') {
        throw new ForbiddenError(result.reason);
      }

      const cookie = buildSessionCookie(result.sessionId);
      reply.setCookie(env.SESSION_COOKIE_NAME, cookie.value, cookie.options);
      reply.redirect(env.WEB_BASE_URL);
    });
  }

  app.post('/api/auth/signout', async (request, reply) => {
    const raw = request.cookies[env.SESSION_COOKIE_NAME];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        await db.session.delete({ where: { id: unsigned.value } }).catch(() => undefined);
      }
    }
    reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });
}
