# torii
A Project Delivery Management Gateway (aka a dashboard)

A Project Delivery Management Gateway — a dashboard for fintech integration projects, with phase / state / key-date tracking and team capacity planning. Pulls from Monday.com; Jira and Linear adapters are planned follow-on changes.

See [openspec/changes/add-integration-dashboard/](openspec/changes/add-integration-dashboard/) for the full proposal, design, specs, and task list.

## Tech stack

- **Monorepo**: pnpm workspaces — `apps/api`, `apps/web`, `packages/shared`
- **API**: TypeScript + Fastify + Prisma + Postgres + `openid-client` (SSO) + `node-cron` (scheduled sync)
- **Web**: TypeScript + React + Vite + TanStack Query + TanStack Table + UnoCSS
- **Tests**: Vitest

## Prerequisites

- Node.js 20+ (developed on 25)
- pnpm 11 (`npm install -g pnpm`)
- Docker + Docker Compose (for local Postgres)

## Quickstart

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres
docker compose up -d

# 3. Configure env
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env — at minimum set SESSION_SECRET, ADMIN_EMAIL, TRACKER_TOKEN_KEY
# generate TRACKER_TOKEN_KEY: openssl rand -hex 32

# 4. Run migrations + seed an admin
pnpm --filter @torii/api prisma:migrate:dev --name init
ADMIN_EMAIL=you@portx.io pnpm --filter @torii/api db:seed

# 5. Start API + web in parallel
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3001

## Sign-in

Torii uses PortX's Keycloak realm as the sole identity provider. Google is federated upstream inside the realm — Torii itself only talks to Keycloak. The API runs the OIDC code flow server-side and issues a signed session cookie; the browser never sees access or ID tokens.

### Dev with real auth (recommended)

```bash
# apps/api/.env
KEYCLOAK_ISSUER=https://auth.piam.tenants.portx.io/realms/central-services
KEYCLOAK_CLIENT_ID=torii-dev
KEYCLOAK_CLIENT_SECRET=...                                   # from the realm
KEYCLOAK_REDIRECT_URI=http://localhost:3000/api/auth/keycloak/callback
ALLOWED_EMAIL_DOMAINS=portx.io
ADMIN_EMAILS=you@portx.io,teammate@portx.io                  # optional
```

First sign-in provisions the user as `role=Viewer`. Emails in `ADMIN_EMAILS` are reconciled to `isAdmin=true` on every sign-in (removing an email demotes that user on their next sign-in). Promotion to `role=PM` is a Torii-side admin action (not handled by sign-in).

The redirect lands on the **web** origin (port 3000); Vite's dev proxy forwards `/api/*` to the API. In production the web and API share an origin so the same shape works.

The Keycloak client provisioned for Torii MUST list `http://localhost:3000/api/auth/keycloak/callback` under **Valid Redirect URIs** AND `http://localhost:3000/signin` (or `http://localhost:3000/*`) under **Valid Post Logout Redirect URIs** — the latter is a separate Keycloak field; allowlisting only Redirect URIs makes sign-out fail with the same "Invalid redirect_uri" error.

### Dev without auth (UX-only work)

When you're iterating on UI without a real session, opt into the synthetic admin bypass on BOTH sides:

```bash
# apps/api/.env
ENABLE_PREVIEW_ADMIN_BYPASS=true

# apps/web/.env.local (or the shell env when running `pnpm dev`)
VITE_DISABLE_AUTH=true
```

Both flags default to `false`. The API flag is hard-rejected at startup when `NODE_ENV=production`.

## Monday.com integration

See [docs/field-ownership.md](docs/field-ownership.md) for how Torii and Monday.com share fields per project.

1. Create a Monday.com OAuth app; copy client id/secret and set the redirect URI to `http://localhost:3001/api/tracker/monday/callback`.
2. Fill `MONDAY_CLIENT_ID` / `MONDAY_CLIENT_SECRET` / `MONDAY_REDIRECT_URI` in `.env`.
3. Sign in as admin and click **Trackers → Connect Monday.com**.
4. In the connection card, paste item ids to import.
5. Enable the 30-minute scheduled sync with `ENABLE_SYNC_CRON=true`.

### Troubleshooting

If a tracker connection shows `Unauthorized field or type` during sync:

1. Verify your Monday OAuth app has read access needed for boards/items queried by Torii.
2. Verify the connected Monday user can open the target boards/items in Monday UI.
3. Reconnect with **Trackers -> Connect Monday.com** after updating app scopes or user access.

This error usually means OAuth succeeded but the token/user lacks permissions for one or more queried schema fields/types.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run API + web in watch mode |
| `pnpm test` | Run all tests across the workspace |
| `pnpm typecheck` | `tsc --noEmit` across every package |
| `pnpm lint` | Run ESLint over `apps/**` and `packages/**` |
| `pnpm format` | Format with Prettier |
| `pnpm build` | Production build for API + web + shared |
| `pnpm --filter @torii/api prisma:migrate:dev` | Generate + apply a new migration |
| `pnpm --filter @torii/api prisma:migrate:deploy` | Apply migrations in non-dev environments |
| `pnpm --filter @torii/api db:seed` | Upsert the admin Person from `ADMIN_EMAIL` |

## Environment variables

See [docs/env.md](docs/env.md) for the full reference. The most commonly set vars:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Signing key for the session cookie (≥16 chars) |
| `TRACKER_TOKEN_KEY` | 64-hex (32-byte) AES-256-GCM key for tracker-token encryption |
| `AUTH_PROVIDERS` | Comma-separated `google`,`okta` |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated list; empty allows all |
| `WEB_BASE_URL` | Where to redirect after sign-in |
| `ADMIN_EMAIL` / `ADMIN_NAME` | Used by `db:seed` |
| `ENABLE_SYNC_CRON` | `true` to enable scheduled sync |

## Project structure

```
torii/
├── apps/
│   ├── api/                 # Fastify API server
│   │   ├── prisma/          # schema + seed
│   │   ├── src/
│   │   │   ├── routes/      # auth, projects, people, allocations, capacity, tracker
│   │   │   ├── sync/        # tracker adapter registry, MondayAdapter, sync engine, cron
│   │   │   ├── plugins/     # session, error handler, role guards
│   │   │   ├── app.ts       # buildApp(...) — wires everything
│   │   │   └── server.ts    # bootstraps from env
│   │   └── test/            # vitest
│   └── web/                 # Vite + React SPA
│       └── src/
│           ├── api/         # client + endpoint wrappers
│           ├── auth/        # AuthProvider + RequireAuth
│           ├── components/  # NavShell, badges, modal, AllocationsPanel
│           └── routes/      # signin, projects-list, project-detail, capacity, trackers
├── packages/shared/         # cross-package types, Zod schemas, ISO-week utils, adapter interface
├── openspec/                # spec-driven workflow artifacts
└── docker-compose.yml       # local Postgres
```
>>>>>>> ac756c2 (Initial creation)
