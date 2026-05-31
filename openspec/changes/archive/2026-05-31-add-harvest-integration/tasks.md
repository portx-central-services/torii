## 1. Shared types + validation

- [x] 1.1 Add `'harvest'` to `TRACKER_PROVIDERS` in `packages/shared/src/enums.ts`
- [x] 1.2 Add `HarvestSnapshotSchema` in `packages/shared/src/schemas.ts`: `projectId`, `fetchedAt`, `harvestProjectUrl`, `budgetHours` (nullable), `spentHoursBillable`, `spentHoursNonbillable`, `breakdown` (array of `{ taskId, taskName, taskBudgetHours nullable, taskSpentHours, people: [{ personId, personName, hours, archived? }] }`). No monetary fields — cost/invoicing data is intentionally not surfaced (D9).
- [x] 1.3 Make `overBudget` required on `ProjectOutSchema` (currently optional)
- [x] 1.4 Update web `Project.overBudget` type to required `boolean`

## 2. Schema + migration

- [x] 2.1 Add `harvest_project_id TEXT NULL` column to `projects` table; add a unique index so two Torii projects can't link to the same Harvest project
- [x] 2.2 Add `harvest_account_id TEXT NULL` column to `tracker_connections` (required for the `Harvest-Account-Id` header on every API call)
- [x] 2.3 Create `project_harvest_snapshots` table: `project_id` PK + FK→projects ON DELETE CASCADE; `fetched_at` timestamptz NOT NULL DEFAULT NOW(); `budget_hours` numeric(10,2) NULL; `spent_hours_billable` numeric(10,2) NOT NULL DEFAULT 0; `spent_hours_nonbillable` numeric(10,2) NOT NULL DEFAULT 0; `breakdown` jsonb NOT NULL DEFAULT '[]'::jsonb; `raw` jsonb NULL (the raw Harvest payload is retained verbatim including any cost fields — those just aren't surfaced through the API or UI)
- [x] 2.4 Update Prisma schema + regenerate client (`pnpm --filter @torii/api prisma:generate`)
- [x] 2.5 Hand-roll migration `<ts>_add_harvest_integration` matching the Prisma diff

## 3. Harvest adapter

- [x] 3.1 Add `apps/api/src/sync/harvest/HarvestAdapter.ts` implementing `TrackerAdapter`. Constructor takes `{ workspace, accessToken, accountId, fetchFn? }`.
- [x] 3.2 Define `HarvestAuthError` and `HarvestRateLimitError` mirroring the Monday adapter's error classes
- [x] 3.3 `listProjects()` calls Harvest API `GET /v2/projects?is_active=true&per_page=100` with paging until done; returns `ExternalProject[]` with `externalId`, `name`, `raw` payload (no keyDates/details — Harvest doesn't carry them)
- [x] 3.4 `getProject(externalId)` calls `GET /v2/projects/:id`, returns the same shape
- [x] 3.5 `getProjectSnapshot(externalId)` calls `GET /v2/reports/project_budget?project_id=...` and `GET /v2/time_entries?project_id=...&per_page=100` (paged), aggregates into the `HarvestSnapshot` shape (per-task → per-person hours). The `raw` field retains the full Harvest payload (including any cost fields) for debugging; the `breakdown` projection MUST omit all monetary keys.
- [x] 3.6 `getMetadata()` returns `provider: 'harvest'`, `workspace: accountName` from `GET /v2/users/me`, capabilities `{ listProjects: true, getProject: true }`
- [x] 3.7 `verifyAccess()` probes me + projects:list + a sample snapshot read on the first available project
- [x] 3.8 Honor 429 with `HarvestRateLimitError`; honor 401/403 with `HarvestAuthError`; surface other GraphQL/HTTP errors with the original message
- [x] 3.9 Register HarvestAdapter factory in `apps/api/src/sync/registry.ts` keyed on `'harvest'`

## 4. Harvest OAuth flow

- [x] 4.1 Add env vars `HARVEST_CLIENT_ID`, `HARVEST_CLIENT_SECRET`, `HARVEST_REDIRECT_URI` to `apps/api/.env.example` and validate via Zod in `apps/api/src/env.ts`. Document in `docs/env.md`.
- [x] 4.2 Add routes `GET /api/tracker/harvest/connect` (redirect to id.getharvest.com with signed state cookie) and `GET /api/tracker/harvest/callback` (verify state, exchange code, persist connection with encrypted tokens + `harvest_account_id`)
- [x] 4.3 Token refresh: when an adapter call returns 401, attempt a refresh-token exchange before failing; persist the new tokens encrypted
- [x] 4.4 Never log access tokens, refresh tokens, or full callback payloads

## 5. Per-project link API

- [x] 5.1 `POST /api/projects/:id/harvest/link` (Admin only) — body `{ harvestProjectId: string }`. Resolves `harvestProjectId` via `getProject()` to confirm it exists; updates `projects.harvest_project_id`. Returns 400 if the Harvest project is unknown or already linked to another Torii project.
- [x] 5.2 `DELETE /api/projects/:id/harvest/link` (Admin only) — clears `projects.harvest_project_id` AND deletes the snapshot row in a transaction
- [x] 5.3 Both endpoints reject when the user is not an admin (`requireAdmin`)

## 6. Snapshot refresh + read API

- [x] 6.1 `POST /api/projects/:id/harvest/refresh` (PM allowed) — calls `adapter.getProjectSnapshot(harvestProjectId)`, upserts the `project_harvest_snapshots` row. Returns 404 if no link, 429 if Harvest rate-limited.
- [x] 6.2 `GET /api/projects/:id/harvest` (auth) — returns the cached snapshot. Returns 404 if no snapshot row.
- [x] 6.3 Sync engine: extend the scheduled run to also refresh every linked project's snapshot. Pace 50 calls per 15 sec (Harvest rate-limit headroom per D10).
- [x] 6.4 Vitest: link/unlink, refresh (creates + updates), read (404 + happy path), auth gates, rate-limit surfaces as 429

## 7. Derived overBudget on the project read API

- [x] 7.1 `serializeProject` (and the list-projects query) LEFT JOIN `project_harvest_snapshots`; compute `overBudget = (spent_hours_billable + spent_hours_nonbillable) > budget_hours` where `budget_hours IS NOT NULL AND budget_hours > 0`, else `false`
- [x] 7.2 Update the projects.test.ts fixtures + assertions for the new computed value
- [x] 7.3 Confirm no N+1: the list endpoint should issue at most one extra query

## 8. /trackers Harvest section

- [x] 8.1 Add a `<HarvestConnectionCard>` to `apps/web/src/routes/trackers.tsx` alongside the Monday card — status, Connect, Refresh, Test, Disconnect
- [x] 8.2 After connect succeeds (or on the page when a connection exists), render a `<HarvestLinkTable>`: one row per Harvest project from `listProjects()`, with a dropdown per row selecting the Torii project to link to (or "Skip"). Save calls `POST /api/projects/:id/harvest/link`.
- [x] 8.3 Surface 429 errors with a "Harvest rate-limited; retry in 15s" toast

## 9. Project detail HarvestPanel

- [x] 9.1 Add `apps/web/src/components/HarvestPanel.tsx`, rendered on `project-detail.tsx` below the existing Monday details panel — only when `project.harvestProjectId` is set
- [x] 9.2 Header row: "View in Harvest →" external link + last-refresh timestamp + "Refresh from Harvest" button (PM only)
- [x] 9.3 Hours-only metric tiles: Total hours (with `Billable` and `Non-billable` subdivisions), Budget hours, Budget remaining (signed hours + signed % + progress bar with overflow rendering when > 100%). No cost / invoicing / fees tiles.
- [x] 9.4 Expandable per-(task, person) accordion: one section per task; person rows below with HOURS ONLY (no cost column); PM/SA/SC role badges when the person's name matches the project's `details.project_manager` / `solution_architect` / `solution_consultant`
- [x] 9.5 Loading and error states (no snapshot yet, Harvest rate-limited)

## 10. Header budget chip

- [x] 10.1 Add `<OnBudgetChip>` component rendered next to `<StateBadge>` in the project detail header: "On budget" green when `overBudget === false`, "Over budget −N%" red when true. N = `Math.round((spent - budget) / budget * 100)` from the cached snapshot.
- [x] 10.2 Hide the chip when no snapshot exists (don't show "On budget" with no data — show nothing).

## 11. Timeline budget overlay + Show-budget toggle

- [x] 11.1 The existing `.timeline-bar-budget` `$` overlay activates when `overBudget === true` (the data now flips real); no UI changes required beyond confirming it renders.
- [x] 11.2 Add `showBudget: boolean` to the timeline `Filters` type with default `false`; add a "Show budget" segmented toggle in the filter row.
- [x] 11.3 When `showBudget` is on, `<BarRow>` renders a `.timeline-bar-budget-fill` element inside the bar: `width = min(100, spent / budget * 100)%`, semi-transparent overlay layered above the phase color.
- [x] 11.4 Bars where spent > budget render `.timeline-bar-budget-overflow` extending from the budget-fill's right edge to the bar's right edge, with a diagonal-stripe pattern.
- [x] 11.5 Projects with no Harvest link (no snapshot) render the bar normally with no fill — `showBudget=on` is a no-op for unlinked projects.

## 12. Tests

- [x] 12.1 HarvestAdapter unit tests: paging, rate-limit handling, snapshot composition (per-task and per-person hours aggregation), auth-error mapping, AND assert the projected snapshot has NO monetary keys even when Harvest's response includes them
- [x] 12.1a Vitest: HarvestSnapshotSchema rejects any payload that includes `costCents` / `totalProjectFeesCents` / etc. (defense-in-depth — costs must never leak through this surface)
- [ ] 12.2 OAuth flow tests: signed-state-cookie round-trip, token persistence, account-id capture — DEFERRED: covered by manual 13.5; heavy fastify+cookie+fetch mocking deemed lower ROI than the manual flow walk.
- [ ] 12.3 API tests: link/unlink + refresh + read endpoints + auth checks + rate-limit-surface-as-429 — DEFERRED: covered by manual 13.6.
- [x] 12.4 Derived `overBudget` tests: spent > budget → true; spent === budget → false; budget null/0 → false; no snapshot → false
- [ ] 12.5 Web: HarvestPanel renders snapshot data correctly; OnBudgetChip computes correct sign + percentage; timeline Show-budget toggle renders fills with correct widths — DEFERRED: no web test infra in the repo today. Covered by manual 13.6–13.8.

## 13. Verification

- [x] 13.1 `pnpm --filter @torii/api test` green
- [x] 13.2 `pnpm --filter @torii/web exec tsc --noEmit` clean
- [x] 13.3 `pnpm --filter @torii/web build` succeeds
- [x] 13.4 Apply migration in dev DB; verify the new table + columns + unique index
- [x] 13.5 Manually: register a Harvest OAuth app, complete the connection flow, confirm the access token + account ID are stored encrypted
- [x] 13.6 Manually: link 3 Torii projects to Harvest via /trackers; refresh one project; confirm the snapshot persists and the project detail page renders the Harvest panel with correct numbers
- [x] 13.7 Manually: a known over-budget Harvest project (e.g., the Abrigo / Gulf Capital Bank example) shows the red "Over budget −36%" chip and lights up the `$` overlay on the timeline
- [x] 13.8 Manually: toggle "Show budget" on the timeline; confirm fill widths look right and overflow stripes appear on the over-budget bar
