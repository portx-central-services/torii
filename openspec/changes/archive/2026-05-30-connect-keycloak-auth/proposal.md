## Why

Torii has authentication scaffolding (direct Google/Okta OIDC env vars in the API and a dev-bypass `AuthProvider` in the web app) but no real sign-in: developers run with an auto-injected admin, and the canonical `sso-auth` spec describes a different application (a Next.js portal-ui) rather than Torii. PortX standardizes on Keycloak with Google federated upstream as the workforce IdP, so the right move is to point Torii at the existing PortX Keycloak realm, drop the half-built direct-OIDC code, and rewrite the `sso-auth` spec to describe Torii's actual architecture.

## What Changes

- Replace the half-built Google/Okta direct OIDC paths in the API with a single **Keycloak** OIDC backend-driven code flow against the existing PortX Keycloak (`https://auth.${env}.piam.tenants.portx.io/realms/<tenant>`). Google remains the practical identity source via Keycloak's upstream-IdP federation — Torii itself only talks to Keycloak.
- Keep the existing **server-side session cookie** model (signed HttpOnly `torii_sess` cookie + Prisma `Session` rows): the API runs the OIDC code exchange, the browser never sees access or ID tokens. The existing `handleSignin` helper (domain check + Person upsert + Session create) becomes the shared post-auth path.
- Map identity to Torii roles via **`ALLOWED_EMAIL_DOMAINS`** (gates sign-in) and a new **`ADMIN_EMAILS`** allowlist (sets `Person.isAdmin = true`). New users provision as `Viewer`; promotion to `PM` stays a Torii-side operation by an admin. Removing an email from `ADMIN_EMAILS` demotes on next sign-in.
- Replace the web app's dev-bypass with a real **sign-in screen**: when `/api/me` reports unauthenticated, render a "Sign in" button that hits `GET /api/auth/keycloak/login`; on return, `/api/me` carries the session. The bypass becomes opt-in (`VITE_DISABLE_AUTH=true`) for UX-only work and defaults OFF.
- Add a **sign-out** path that clears the local session cookie and hits Keycloak's end-session endpoint, returning users to the sign-in screen.
- **Remove** the direct Google/Okta OIDC env vars (`GOOGLE_*`, `OKTA_*`, `AUTH_PROVIDERS`) and the `routes/auth/oidc-client.ts` / Google/Okta route handlers. Add `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_REDIRECT_URI`, and `ADMIN_EMAILS`.
- **Rewrite** the canonical `sso-auth` spec: every requirement currently in it was authored for a Next.js portal-ui (uses `react-oidc-context`-style `useAuth()`, `sessionStorage` token storage, Next.js `rewrites()` proxy, etc.) and does not describe Torii. The new requirements describe Torii's backend code flow + session cookie pattern.
- Tracker integrations (Monday today, Jira future) remain independent of user sign-in. Monday's per-connection OAuth is unchanged.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sso-auth`: Wholesale rewrite — REMOVE the 15 Next.js-portal-ui-specific requirements and ADD Torii-specific requirements covering Keycloak backend code flow, session-cookie identity, Person provisioning, domain/allowlist gates, dev-bypass policy, and sign-out semantics.

## Impact

- **Affected code**: `apps/api/src/env.ts` (env vars), `apps/api/.env.example`, `apps/api/src/routes/auth/*` (replace), `apps/api/src/routes/auth/handle-signin.ts` (admin reconciliation), `apps/api/src/plugins/session.ts` (preview-bypass default off), `apps/web/src/auth/AuthProvider.tsx` (real auth), `apps/web/src/auth/RequireAuth.tsx`, `apps/web/src/routes/Signin.tsx` (new), web routing.
- **APIs**: `GET /api/auth/keycloak/login`, `GET /api/auth/keycloak/callback`, `POST /api/auth/signout`. Removes `GET /api/auth/google/*`, `GET /api/auth/okta/*`.
- **Schema**: none. Existing `Session` and `Person` models cover everything.
- **Dependencies**: a server-side OIDC helper (e.g., `openid-client`) for token exchange. No new client-side OIDC library.

## Non-goals

- Per-tracker OAuth (Monday, Jira) is unchanged by this change.
- No role-management UI for PMs/Admins inside Torii in this change — promotion stays via `ADMIN_EMAILS` env var and direct DB edit for `role`.
- No Keycloak realm provisioning automation; this change consumes the existing PortX realm. Allowlisting Torii's callback URL in the realm is an operator action documented in this change.
- No SPA-side PKCE/Bearer token flow; the backend remains the OIDC client.
- No federation-token exchange to Monday/Jira (Monday OAuth stays a separate per-connection flow).

## Rollback plan

- Revert the API auth routes, env schema, and web AuthProvider/Sign-in route. Set `VITE_DISABLE_AUTH=true` in dev to restore the bypass. No data migration to undo: the Person/Session tables already exist and are auth-provider-agnostic.
- If the PortX realm needs to be backed out, set `KEYCLOAK_ISSUER` empty and the API will refuse to start in production (fail-fast); dev environments can re-enable the bypass.

## Affected teams

- **PMO / Engineering** — sign-in changes from "auto-admin in dev" to "Keycloak/Google login" everywhere. Users in the allowlisted domain land as Viewers on first sign-in.
- **Platform / IT** — must allowlist Torii's callback URL in the relevant Keycloak realm(s) and confirm Google federation is configured on that realm.
