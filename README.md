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

Torii uses SSO via Google or Okta. Configure one or both:

```bash
# .env
AUTH_PROVIDERS=google
ALLOWED_EMAIL_DOMAINS=portx.io
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback
```

First sign-in auto-provisions the user as a `Viewer`. The seeded admin (from `ADMIN_EMAIL`) is a `PM` with `is_admin=true`.

## Monday.com integration

See [docs/field-ownership.md](docs/field-ownership.md) for how Torii and Monday.com share fields per project.

1. Create a Monday.com OAuth app; copy client id/secret and set the redirect URI to `http://localhost:3001/api/tracker/monday/callback`.
2. Fill `MONDAY_CLIENT_ID` / `MONDAY_CLIENT_SECRET` / `MONDAY_REDIRECT_URI` in `.env`.
3. Sign in as admin and click **Trackers → Connect Monday.com**.
4. In the connection card, paste item ids to import.
5. Enable the 30-minute scheduled sync with `ENABLE_SYNC_CRON=true`.

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
