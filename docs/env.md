# Environment variables

Every variable consumed by `apps/api`. Validated at startup by `apps/api/src/env.ts`. An invalid or missing required var causes the process to exit immediately.

A complete example lives at [`apps/api/.env.example`](../apps/api/.env.example). Copy it to `apps/api/.env` and edit.

## Required

| Variable | Description | Example |
| --- | --- | --- |
| `DATABASE_URL` | Postgres connection string consumed by Prisma. | `postgresql://torii:torii@localhost:5432/torii?schema=public` |
| `SESSION_SECRET` | Signing key for the session cookie. At least 16 characters; longer is better. | output of `openssl rand -base64 32` |

## Server runtime

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | Standard Node convention. `production` switches the session cookie to `Secure`. |
| `PORT` | `3001` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `SESSION_COOKIE_NAME` | `torii_sess` | Cookie name for the signed session id. |
| `WEB_BASE_URL` | `http://localhost:3000` | Used as the post-sign-in redirect target and as the redirect after a successful Monday.com OAuth callback. |

## Sign-in (Keycloak)

Torii uses the PortX Keycloak realm as the sole IdP. Google sign-in is federated upstream inside the realm — Torii itself only talks to Keycloak. The API is the OIDC client; tokens stay server-side and the browser only sees the signed `torii_sess` session cookie.

| Variable | Description |
| --- | --- |
| `KEYCLOAK_ISSUER` | Full realm URL, e.g. `https://auth.preview.piam.tenants.portx.io/realms/preview`. Required in production (the API exits at startup if unset). |
| `KEYCLOAK_CLIENT_ID` | Confidential client provisioned for Torii in the realm. |
| `KEYCLOAK_CLIENT_SECRET` | Confidential client secret. Server-side only — never exposed to the browser bundle. |
| `KEYCLOAK_REDIRECT_URI` | Must match the value listed in the Keycloak client's "Valid Redirect URIs". Use the **web** origin (port 3000) — Vite proxies `/api/*` to the API. Local dev default: `http://localhost:3000/api/auth/keycloak/callback`. |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated list (case-insensitive) of allowed sign-in domains. Empty disables the gate (dev only). |
| `ADMIN_EMAILS` | Comma-separated list of emails (case-insensitive) whose `Person.isAdmin` is reconciled to `true` on every sign-in. Removing an email demotes that user on their next sign-in. |
| `ENABLE_PREVIEW_ADMIN_BYPASS` | Dev-only synthetic admin session. Default `false`. Hard-rejected at startup when `NODE_ENV=production`. |

### Required Keycloak realm configuration

On the Keycloak side, the client provisioned for Torii MUST list:

- **Valid Redirect URIs**: `${WEB_BASE_URL}/api/auth/keycloak/callback` (must match `KEYCLOAK_REDIRECT_URI` exactly — same scheme, host, port, and path; no trailing slash). The callback lands on the web origin so the Vite dev proxy (or the prod reverse proxy) forwards it to the API.
- **Valid Post Logout Redirect URIs**: `${WEB_BASE_URL}/signin` (or `${WEB_BASE_URL}/*` to allowlist the entire origin). This is a separate Keycloak field from Valid Redirect URIs — allowlisting only the latter will still cause sign-out to fail with "Invalid redirect_uri".

Without these, Keycloak rejects the authorize or end-session round trip with its standard "Invalid redirect_uri" error.

## Tracker integration (Monday.com)

| Variable | Description |
| --- | --- |
| `MONDAY_CLIENT_ID` / `MONDAY_CLIENT_SECRET` | OAuth client credentials from your Monday.com developer app. Required to start the `Connect Monday.com` flow. |
| `MONDAY_REDIRECT_URI` | Must match the redirect URI configured in the Monday.com app, e.g. `http://localhost:3001/api/tracker/monday/callback`. |
| `TRACKER_TOKEN_KEY` | 32-byte AES-256-GCM key, hex-encoded (64 hex characters). Encrypts tracker access tokens at rest in `tracker_connections`. Generate with `openssl rand -hex 32`. Rotating this key invalidates every stored token. |
| `ENABLE_SYNC_CRON` | `true` / `1` to enable the 30-minute scheduled sync over every non-`auth_failed` tracker connection. Default `false`. On-demand refresh via the UI still works regardless. |

## Seeding

| Variable | Description |
| --- | --- |
| `ADMIN_EMAIL` | Required by `pnpm --filter @torii/api db:seed`. Upserts a Person with that email as `PM` with `is_admin=true`. |
| `ADMIN_NAME` | Optional display name. Defaults to the local part of `ADMIN_EMAIL`. |

## Generating secrets

```bash
# Session cookie secret
openssl rand -base64 48

# TRACKER_TOKEN_KEY (must be 64 hex chars = 32 bytes)
openssl rand -hex 32
```

## What's not an env var

- Sign-in providers no longer live in env. Keycloak is the only IdP Torii talks to; Google federation is configured inside the Keycloak realm.
- Per-project field ownership is stored in the database under `Project.field_mapping`, not in env. See [field-ownership.md](field-ownership.md).
