## 1. Environment + config

- [x] 1.1 Add `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_REDIRECT_URI`, `ADMIN_EMAILS`, and `ENABLE_PREVIEW_ADMIN_BYPASS` to `apps/api/src/env.ts` (zod schema) with sensible defaults / fail-fast rules
- [x] 1.2 Remove `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI`, `OKTA_*`, and `AUTH_PROVIDERS` from the env schema and `.env.example`
- [x] 1.3 Update `apps/api/.env.example` to document the new Keycloak vars and the admin allowlist, with realistic placeholders
- [x] 1.4 Fail-fast rules: `KEYCLOAK_ISSUER` empty in `NODE_ENV=production` → exit; `ENABLE_PREVIEW_ADMIN_BYPASS=true` in `NODE_ENV=production` → exit
- [x] 1.5 Update `docs/env.md` (or README) to document the new env vars AND the operator-side Keycloak client allowlist entries (callback + post-logout URIs)

## 2. API: Keycloak OIDC client

- [x] 2.1 Add `openid-client` to `apps/api/package.json` dependencies
- [x] 2.2 Replace `apps/api/src/routes/auth/oidc-client.ts` with a Keycloak-only helper that lazily discovers the issuer, caches the discovery doc, and exposes a typed client (clientId/secret from env)
- [x] 2.3 Build `GET /api/auth/keycloak/login`: generate `state` + PKCE `code_verifier/code_challenge`, store in a short-lived signed cookie, redirect to the authorize URL
- [x] 2.4 Build `GET /api/auth/keycloak/callback`: validate state, perform code exchange (with PKCE verifier), verify ID token signature + claims, derive `{ email, name, email_verified }`, call `handleSignin`
- [x] 2.5 Build `POST /api/auth/signout`: delete the current `Session` row, clear the `torii_sess` cookie, return `{ endSessionUrl }` constructed from the Keycloak end-session endpoint with `post_logout_redirect_uri = ${WEB_BASE_URL}/signin`
- [x] 2.6 Remove the dead Google/Okta route handlers and OIDC plumbing from `apps/api/src/routes/auth/index.ts`

## 3. API: identity → role glue

- [x] 3.1 Extend `handleSignin` (or wrap it) to reconcile `Person.isAdmin` against `ADMIN_EMAILS` on every sign-in (set true if in list, false otherwise)
- [x] 3.2 Confirm domain rejection happens before any Person mutation (it already does — add a test)
- [x] 3.3 Add unit tests for the admin reconciliation (in-list promotes, removed-from-list demotes, case-insensitive match)

## 4. API: session hook + preview bypass policy

- [x] 4.1 Pass `enablePreviewAdminBypass: env.ENABLE_PREVIEW_ADMIN_BYPASS` from `app.ts` into `registerSessionHook` (currently controlled by another flag); default the env var to `false`
- [x] 4.2 Add a startup assertion that rejects `ENABLE_PREVIEW_ADMIN_BYPASS=true` when `NODE_ENV=production`
- [x] 4.3 Add a test that proves an unauthenticated request stays unauthenticated when the bypass env var is unset, even if the legacy `torii_preview_admin` cookie is present

## 5. Web: sign-in surface + guard

- [x] 5.1 Add `apps/web/src/routes/Signin.tsx` rendering the sign-in screen with a primary action linking to `/api/auth/keycloak/login`; show a friendly error pane when the URL contains `?signin_error=...`
- [x] 5.2 Wire `/signin` into the router and ensure it's the ONLY route reachable without auth
- [x] 5.3 Rewrite `apps/web/src/auth/RequireAuth.tsx` (or the guard) so unauthenticated `/api/me` results redirect to `/signin`
- [x] 5.4 Rewrite `apps/web/src/auth/AuthProvider.tsx`: remove auto-bypass; the bypass activates only when `VITE_DISABLE_AUTH=true` AND `/api/me` returns the synthetic admin (or fall back gracefully if the API doesn't honor the bypass)
- [x] 5.5 Update the Sign-out button in `NavShell.tsx`: call `POST /api/auth/signout`, then navigate the browser to the returned `endSessionUrl`

## 6. Telemetry + errors

- [x] 6.1 Structured log lines (request id, email-domain, allowed/denied) for sign-in failures: state mismatch, ID-token verification failure, disallowed domain
- [x] 6.2 On callback failure, redirect to `/signin?signin_error=<short_code>` so the user sees the right message instead of a stack trace
- [x] 6.3 Never log the access token, ID token, or refresh token (add a guard in the Keycloak client helper)

## 7. Tests

- [x] 7.1 Vitest: `apps/api/test/auth-keycloak.test.ts` covering login redirect (state cookie set), callback success (mock token endpoint, Person upsert + Session create + cookie set), state mismatch (400), invalid token (400)
- [x] 7.2 Vitest: admin reconciliation behavior (promotion, demotion, case-insensitive)
- [x] 7.3 Vitest: `POST /api/auth/signout` deletes Session, clears cookie, returns end-session URL
- [x] 7.4 Vitest: preview-admin bypass policy (off by default, hard-reject in production)
- [x] 7.5 Web typecheck (`pnpm --filter @torii/web exec tsc --noEmit`) and build pass

## 8. Operator + dev docs

- [x] 8.1 Add a "Sign-in" section to the README pointing at the Keycloak env vars and admin allowlist
- [x] 8.2 Add a short "Dev with real auth" recipe (set the Keycloak vars + use the preview realm) and a "Dev without auth" recipe (set both bypass flags)
- [x] 8.3 Note the operator-side Keycloak client allowlist requirement in `docs/env.md` (callback URL, post-logout URL)

## 9. Verification

- [x] 9.1 `pnpm --filter @torii/api test` green
- [x] 9.2 `pnpm --filter @torii/web exec tsc --noEmit` clean
- [x] 9.3 `pnpm --filter @torii/web build` succeeds
- [ ] 9.4 In a running dev environment with real Keycloak env vars: open the app → see `/signin` → click sign-in → Keycloak (Google federation) → land back signed in
- [ ] 9.5 Sign in as a non-admin domain user — confirm Viewer role and `isAdmin=false`
- [ ] 9.6 Sign in as an `ADMIN_EMAILS` user — confirm `isAdmin=true`; remove from list, sign in again — confirm `isAdmin=false`
- [ ] 9.7 Sign-out flow: clears cookie, hits Keycloak end-session, lands on `/signin`
- [ ] 9.8 Confirm Monday tracker connection still works (independent of Keycloak sign-in)
