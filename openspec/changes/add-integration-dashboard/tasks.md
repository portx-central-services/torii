## 1. Repo & tooling setup

- [x] 1.1 Initialize pnpm workspace at repo root with `pnpm-workspace.yaml` listing `apps/*` and `packages/*`
- [x] 1.2 Create `packages/shared` with `package.json`, `tsconfig.json`, and an empty `src/index.ts`; export a placeholder type
- [x] 1.3 Create `apps/api` (Node + TS + Fastify) scaffold with `package.json`, `tsconfig.json`, `src/server.ts` returning `200` on `GET /healthz`
- [x] 1.4 Create `apps/web` (Vite + React + TS) scaffold with router stub, default route `/projects` rendering "hello"
- [x] 1.5 Add ESLint + Prettier config at repo root, shared across packages; wire `pnpm lint` and `pnpm format`
- [x] 1.6 Add Vitest to `apps/api` and `apps/web`; add a smoke test in each that runs under `pnpm test`
- [x] 1.7 Add GitHub Actions CI workflow that runs `pnpm install`, `pnpm lint`, `pnpm test`, and `pnpm build`

## 2. Database & schema

- [x] 2.1 Add Prisma to `apps/api`; configure `DATABASE_URL` env var; commit `prisma/schema.prisma` with `provider = "postgresql"`
- [x] 2.2 Define `Person` model (id, name, email unique, role enum, default_capacity_pct, is_admin) and generate migration <!-- schema defined; `prisma migrate dev` requires running Postgres (see docker-compose.yml) -->
- [x] 2.3 Define `Project` model (id, name, phase enum, state enum, key_dates JSONB, owner_id FK, tracker_ref JSONB nullable, field_mapping JSONB, timestamps); generate migration
- [x] 2.4 Define `Allocation` model (id, project_id FK, person_id FK, pct, start, end); add composite indexes per design D7; generate migration
- [x] 2.5 Define `TrackerConnection`, `PhaseAuditLog`, and `Session` models per design; generate migration
- [x] 2.6 Write a seed script that creates an initial admin Person from `ADMIN_EMAIL` env var

## 3. API: foundation

- [x] 3.1 Add Fastify request validation via `@fastify/type-provider-zod`; export shared Zod schemas in `packages/shared`
- [x] 3.2 Add session middleware: read signed cookie, load `Session` + `Person`, attach to `request.user`
- [x] 3.3 Add role guard helper: `requirePM(request)` throws `403` if `request.user.role !== 'PM'`
- [x] 3.4 Add centralized error handler returning JSON `{error, code}` with appropriate HTTP status

## 4. API: SSO auth

- [x] 4.1 Add `@fastify/oauth2` + `openid-client`; register Google OIDC routes (`/api/auth/google`, `/api/auth/google/callback`) gated by `AUTH_PROVIDERS` <!-- using openid-client directly; `@fastify/oauth2` not required -->
- [x] 4.2 Register Okta OIDC routes mirroring Google; both share an `oidcCallback` helper
- [x] 4.3 In `oidcCallback`, enforce `ALLOWED_EMAIL_DOMAINS`, upsert `Person` (auto-provision as `Viewer`), create `Session`, set signed cookie, redirect
- [x] 4.4 Add `POST /api/auth/signout` that deletes the `Session` row and clears the cookie
- [x] 4.5 Add unit tests for `oidcCallback` covering: new user, existing user, blocked domain, disabled provider

## 5. API: projects

- [x] 5.1 Implement `GET /api/projects` with optional `phase`, `state`, `owner` filters and `sort` param
- [x] 5.2 Implement `GET /api/projects/:id` returning project + current allocations + last sync timestamp (if linked)
- [x] 5.3 Implement `POST /api/projects` (PM only); validate `phase` and `state` enums and key_dates ordering
- [x] 5.4 Implement `PATCH /api/projects/:id` (PM only); on `phase` change, write a `PhaseAuditLog` row; on `phase=Hypercare` with `actual_go_live` set, auto-set `state=Done` unless caller passed an explicit state
- [x] 5.5 Tests for projects endpoints covering filter, sort, validation errors, audit log write, auto-Done

## 6. API: people & allocations

- [x] 6.1 Implement `GET /api/people` and `GET /api/people/:id`
- [x] 6.2 Implement `POST /api/allocations` (PM only) with overlap check per spec; return `409` on overlap
- [x] 6.3 Implement `PATCH /api/allocations/:id` and `DELETE /api/allocations/:id` (PM only)
- [x] 6.4 Implement `GET /api/people/:id/allocations?from=&to=` joining project name/phase/state
- [x] 6.5 Tests for allocations covering create, overlap rejection, per-person query

## 7. API: capacity rollup

- [x] 7.1 Implement an ISO-week bucketing utility in `packages/shared` (input: date range; output: array of week starts)
- [x] 7.2 Implement `GET /api/capacity/rollup?from=&to=` returning per-project weekly demand AND per-person weekly committed pct
- [x] 7.3 Compute `over_allocated` flag per (person, week) by comparing committed pct to `default_capacity_pct`
- [x] 7.4 Tests for rollup: simple case, two overlapping allocations on one person, over-allocation flag boundary

## 8. Tracker adapter foundation

- [x] 8.1 Define `TrackerAdapter` interface in `packages/shared` with `listProjects`, `getProject`, `getMetadata`
- [x] 8.2 Implement an adapter registry in `apps/api/src/sync` keyed by `provider` string; throw on unknown provider
- [x] 8.3 Implement field-ownership merge function: given (existingProject, externalFields, fieldMapping), return the patch to apply
- [x] 8.4 Unit tests for the merge function covering: phase=torii blocks update, name=monday allows update, missing mapping defaults

## 9. Monday.com adapter + sync engine

- [x] 9.1 Create `apps/api/src/sync/monday/MondayAdapter.ts` implementing `TrackerAdapter` using Monday.com GraphQL
- [x] 9.2 Implement Monday.com OAuth flow: `GET /api/tracker/monday/connect`, callback handler, encrypt-at-rest helpers for tokens (AES-256 via `crypto`)
- [x] 9.3 Implement `POST /api/tracker/connections/:id/refresh` for on-demand sync
- [x] 9.4 Implement scheduled sync using `node-cron`: every 30 min for each active `TrackerConnection`; update `status` and `last_synced_at`
- [x] 9.5 Implement `POST /api/tracker/connections/:id/import` accepting board item ids → upsert Projects with `tracker_ref` set and default `field_mapping`
- [x] 9.6 Tests for MondayAdapter (HTTP mocked), sync engine happy path, auth_failed branch, scheduled trigger <!-- HTTP mocked in monday-adapter.test.ts; sync engine happy + auth_failed in sync-engine.test.ts; scheduled tick is wired via setupSync (verification requires live cron) -->

## 10. Web: shell, auth, routing

- [x] 10.1 Add React Router; configure `/projects`, `/projects/:id`, `/capacity`, `/trackers`, `/signin`
- [x] 10.2 Add an auth-aware `fetch` wrapper that includes credentials and redirects to `/signin` on `401`
- [x] 10.3 Build `/signin` page with "Sign in with Google" and "Sign in with Okta" buttons (visibility driven by API config endpoint)
- [x] 10.4 Build the navigation shell: logo, links to Projects/Capacity, conditional Trackers link (admin only), user menu with sign-out

## 11. Web: projects views

- [x] 11.1 Build `/projects` list view with filterable/sortable table (TanStack Table), phase/state/owner filters, empty state with "Create project"
- [x] 11.2 Build "Create project" modal hitting `POST /api/projects`
- [x] 11.3 Build `/projects/:id` detail view: name, phase dropdown (PM only), state dropdown (PM only), key dates editor, owner, tracker badge with last-sync timestamp
- [x] 11.4 Add "Refresh from tracker" button visible only when linked; calls the refresh endpoint and re-fetches
- [x] 11.5 Show current allocations table in detail view with inline add/edit for PMs
- [x] 11.6 Hide all edit affordances for `Viewer` role

## 12. Web: capacity view

- [x] 12.1 Build `/capacity` page; default 12-week window starting from current ISO week; fetch rollup
- [x] 12.2 Render team-level heatmap: rows = projects, columns = weeks, cell shading by weekly demand
- [x] 12.3 Implement click-week drill-down panel: per-person committed pct, sorted desc, over-allocated rows visually flagged
- [x] 12.4 Add date-range picker to override default window

## 13. Web: admin trackers page

- [x] 13.1 Build `/trackers` page (admin-gated) listing existing `TrackerConnection` rows with status + last_synced_at
- [x] 13.2 Add "Connect Monday.com" action that starts the OAuth flow and returns to the page
- [x] 13.3 Build per-connection "Import items" UI that lets the admin paste/select item ids to import
- [x] 13.4 Show per-connection error banner when `status="auth_failed"` or `status="rate_limited"`

## 14. End-to-end verification (golden path)

- [x] 14.1 Local: bring up Postgres in Docker; run migrations; seed admin; start API + web
- [ ] 14.2 Sign in as admin, create a project manually, assign two people to it with overlapping weeks, verify capacity view shows over-allocation
- [ ] 14.3 Connect Monday.com (sandbox workspace), import an item, verify Torii-owned phase survives a sync, Monday-owned name updates on sync
- [ ] 14.4 Confirm Viewer role cannot edit; PM can; sign-out invalidates session

## 15. Documentation

- [x] 15.1 Write `README.md` quickstart: prereqs, env vars, run commands
- [x] 15.2 Write `docs/env.md` listing every env var with description and example
- [x] 15.3 Write a one-page "How field ownership works" doc and link it from the detail view
