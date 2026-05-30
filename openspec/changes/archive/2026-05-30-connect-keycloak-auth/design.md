## Context

Two existing realities collide here:

1. **The API has half-built direct OIDC scaffolding** (`GOOGLE_*`, `OKTA_*` env vars; `apps/api/src/routes/auth/{index.ts,oidc-client.ts}`) plus a working **session model** (`Session` table + signed `torii_sess` cookie + sliding expiry in `apps/api/src/plugins/session.ts`) and a provider-agnostic `handleSignin(claims)` helper that does domain check + Person upsert + Session create.
2. **The web app has a dev-bypass** `AuthProvider` (`apps/web/src/auth/AuthProvider.tsx`) that injects a synthetic admin in dev mode and only does light wiring in prod.
3. **The canonical `sso-auth` spec** was copied from a Next.js portal-ui app during the earlier integration-dashboard archive; every requirement describes browser-side PKCE + `react-oidc-context`-style hooks + Next.js rewrites — none of which match Torii's architecture.

PortX's workforce IdP is Keycloak at `https://auth.${env}.piam.tenants.portx.io/realms/<tenant>`, with Google federated upstream. This change targets that existing infrastructure rather than introducing a new IdP or local Keycloak.

## Goals / Non-Goals

**Goals:**
- Real Keycloak sign-in replaces the dev bypass (which becomes opt-in only).
- The API remains the single OIDC client; the browser never touches access/ID tokens.
- The existing session-cookie infrastructure is preserved end-to-end.
- The `sso-auth` canonical spec accurately describes Torii.
- Identity → role is deterministic and operator-controlled (domain gate + admin allowlist) — no per-user role UI in this change.

**Non-Goals:**
- SPA PKCE / Bearer-token flow.
- Per-tracker SSO/federation (Monday/Jira keep their own OAuth flows).
- A Torii-side UI for promoting users to PM/Admin.
- Schema changes (Person / Session already cover everything needed).
- Operator-side Keycloak realm provisioning automation.

## Decisions

### Backend-driven OIDC code flow + session cookie

The API initiates Keycloak's authorization code flow and exchanges the code server-side for ID + access tokens. After successful exchange, `handleSignin(claims)` upserts the Person and creates a `Session` row; the API responds with a signed `torii_sess` cookie and redirects the user back to the web app. Browser code never observes the upstream tokens.

Rationale:
- Matches the existing session-cookie infrastructure (`@fastify/cookie`, signed cookies, sliding expiry).
- Keeps Keycloak's client-secret server-side (Torii's Keycloak client is **confidential**, not public).
- Avoids the operational complexity of browser-side PKCE + silent renewal + token storage (none of which the Vite SPA carries today).
- Simpler test story: route tests can call `handleSignin` directly with synthesized claims; integration tests can mock the Keycloak token endpoint.

**Alternative considered:** SPA PKCE + Bearer (the pattern the existing canonical spec describes). Rejected — Torii's API depends on a session cookie throughout (every guard reads `request.user`), and rebuilding that surface for Bearer tokens is a larger change than the user needs right now.

### Identity → role mapping

The `Person` table is the source of truth for `role` and `isAdmin`. On every successful sign-in:

1. **Domain gate:** `ALLOWED_EMAIL_DOMAINS` must contain the email's domain or sign-in is rejected (existing behavior, kept). Empty list disables the gate (dev mode).
2. **Person upsert:** Create the row with `role = Viewer` on first sign-in; update `name` on every sign-in.
3. **Admin reconciliation:** Set `Person.isAdmin = ADMIN_EMAILS.includes(email)`. This means removing an email from `ADMIN_EMAILS` demotes that user from admin on their next sign-in.
4. **Role promotion (PM):** Out of scope here. Stays a direct DB / future-UI concern.

Rationale: operators have a single env var to control admin without touching the DB; promotion to PM remains an explicit, intentional step.

**Alternative considered:** Keycloak realm/client roles → Torii roles via token claims. Rejected per the scoping decision — keeps role logic out of Keycloak so the realm can stay a generic workforce IdP, and avoids a coupling between Keycloak admin and Torii's role model.

### `sso-auth` canonical spec is rewritten, not patched

The 15 current requirements describe a different app. A delta spec under this change uses `## REMOVED Requirements` to drop each one (with a short `Reason` and a `Migration` pointer to the Torii equivalent) and `## ADDED Requirements` to introduce Torii's actual auth contract. Result, after archive: the canonical `sso-auth` spec describes Torii's backend OIDC + session cookie auth in 8–10 clean requirements.

Rationale: piecemeal MODIFIED would leave a tangle. A clean replace is honest and short to read.

### Dev bypass policy

The existing preview-admin bypass (`torii_preview_admin` cookie + `VITE_DISABLE_AUTH` flag in the web app + `enablePreviewAdminBypass` option on the session hook) stays, but defaults OFF. Enabling requires explicit `VITE_DISABLE_AUTH=true` plus an API env flag (`ENABLE_PREVIEW_ADMIN_BYPASS=true`). In production builds the API flag is hard-rejected by the env schema unless `NODE_ENV !== 'production'`. This keeps UX-only work fast without making it a security footgun.

### Library choice

Use `openid-client` (well-maintained, RFC-correct OIDC client for Node) for discovery, code exchange, and end-session URL construction. Avoids hand-rolling token validation. Configured once at app startup against `KEYCLOAK_ISSUER` and the confidential client credentials.

## Sequence (sign-in)

```
Browser                  Torii API                Keycloak
   │                        │                        │
   │ GET /api/auth/keycloak/login                    │
   │ ──────────────────────►│                        │
   │                        │ build authorize URL    │
   │                        │ (state, nonce, PKCE)   │
   │                        │ set state cookie       │
   │ ◄── 302 to Keycloak ───│                        │
   │ ────────────────────────────────────────────────►│
   │                        │                        │ (Google federation if used)
   │ ◄── 302 to /api/auth/keycloak/callback?code=… ──│
   │ ──────────────────────►│                        │
   │                        │ exchange code for tokens
   │                        │────────────────────────►│
   │                        │ ◄── id_token, access ──│
   │                        │ verify, parse claims   │
   │                        │ handleSignin(claims)   │
   │                        │   upsert Person        │
   │                        │   reconcile isAdmin    │
   │                        │   create Session       │
   │                        │ set torii_sess cookie  │
   │ ◄── 302 to WEB_BASE_URL │                        │
```

## Sequence (sign-out)

```
Browser → POST /api/auth/signout
API:    delete Session row, clear torii_sess cookie
        respond { endSessionUrl } (Keycloak end-session URL with post_logout_redirect_uri = WEB_BASE_URL + "/signin")
Browser → follows endSessionUrl
Keycloak ends SSO session, 302 back to /signin
```

## Risks / Trade-offs

- **Realm callback allowlist** → operators must add `${API_BASE_URL}/api/auth/keycloak/callback` to the Keycloak client's Valid Redirect URIs. Documented in `docs/env.md` and surfaced in the README. Without this the first sign-in attempt errors at Keycloak.
- **Confidential client secret leakage** → kept in `KEYCLOAK_CLIENT_SECRET` env var; never logged. Standard 12-factor hygiene.
- **Demote-on-next-signin lag** → removing an admin from `ADMIN_EMAILS` only takes effect on their next sign-in. Mitigation: explicit `Session` deletion endpoint (out of scope; can be added). Acceptable for the workforce model.
- **Domain mis-typo locks people out** → `ALLOWED_EMAIL_DOMAINS` is a comma-separated env var; a typo silently rejects valid users. Mitigation: API logs the domain in the rejection error; documented in `docs/env.md`.
- **Federation drift** → if the realm reconfigures Google federation, Torii observes the symptoms (sign-in fails or wrong email shape) but has no insight. Mitigation: rely on Keycloak operator notice; no Torii-side compensation needed.

## Migration plan

1. Land the API + web changes behind a runtime check: if `KEYCLOAK_ISSUER` is unset, the API still starts (logs a warning) and the web app shows the sign-in screen with the button disabled — so we can ship the code without breaking dev loops mid-deploy.
2. Operators allowlist `${API_BASE_URL}/api/auth/keycloak/callback` in the relevant Keycloak realm clients and provision a confidential client for Torii.
3. Set `KEYCLOAK_*` env vars in each environment; the next deploy enables real sign-in.
4. Remove the direct Google/Okta env vars and code in the same change (no migration needed — they were never wired to anything live).
5. Communicate to PMs that first sign-in will produce a `Viewer` row; existing dev sessions are unaffected because the bypass remains under an opt-in flag.

## Open Questions

- **Production cookie attributes:** keep `SameSite=Lax` (current) or move to `Strict` once the API and web app share an origin behind a single load balancer? Default Lax for now to keep cross-subdomain auth working during phased rollout.
- **Long-running scheduled sync as the "user":** the cron tick already runs without a session — unchanged. If a future change needs sync to act as a specific Person, that's a separate decision.
- **`prompt=login` on every Keycloak round trip after sign-out?** The old portal spec forced `prompt=login` to suppress silent re-auth via Google. Defer until we see whether the Torii sign-out UX actually needs it.
