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

## SSO

| Variable | Description |
| --- | --- |
| `AUTH_PROVIDERS` | Comma-separated subset of `google`,`okta`. Providers not listed have no routes; their `/api/auth/<provider>` URLs return `404`. |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated list (case-insensitive) of allowed sign-in domains. Empty means "allow any authenticated email". |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | OIDC client config; required only when `google` is enabled. Redirect URI must be `<api>/api/auth/google/callback`. |
| `OKTA_ISSUER` / `OKTA_CLIENT_ID` / `OKTA_CLIENT_SECRET` / `OKTA_REDIRECT_URI` | OIDC client config; required only when `okta` is enabled. Issuer is the Okta org URL, e.g. `https://your-org.okta.com`. |

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

- The provider list at sign-in is computed server-side from `AUTH_PROVIDERS` and exposed via `GET /api/auth/config`. The web client renders only the providers the API admits to.
- Per-project field ownership is stored in the database under `Project.field_mapping`, not in env. See [field-ownership.md](field-ownership.md).
