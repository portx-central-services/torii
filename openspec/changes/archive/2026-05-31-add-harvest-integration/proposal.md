## Why

Torii surfaces what's at-risk and how the portfolio falls on the calendar, but it has zero visibility into how much delivery effort each project is consuming. A delivery lead reviewing the Risks page can see a project is Red, but can't see they're already 36% over the Harvest hours budget — and that overage is often the real driver behind the RAG color. The Abrigo / Gulf Capital Bank example (838.50 hours spent against a 615-hour budget) is exactly the signal the PMO needs at every Monday stand-up. This change brings the hours-budget signal into Torii; financial data (costs, invoicing) stays in Harvest and is intentionally NOT surfaced here.

## What Changes

### New: Harvest as a second tracker provider

- Extend `TrackerProvider` from `['monday']` to `['monday', 'harvest']`.
- Reuse the existing `TrackerConnection` table for Harvest auth: provider='harvest', encrypted access/refresh tokens, OAuth2 flow shape mirroring the Monday flow (signed state cookie, callback at `/api/tracker/harvest/callback`, token exchange against `id.getharvest.com`).
- Add a nullable `TrackerConnection.harvest_account_id` column — Harvest's API requires an `Harvest-Account-Id` header on every request alongside the bearer token; the account ID is returned in the OAuth callback.
- New `HarvestAdapter` implementing `TrackerAdapter`:
  - `listProjects()` — every Harvest project the connected admin can see (with paging). Powers the bulk-link picker.
  - `getProject(externalId)` — single-project metadata.
  - New Harvest-only method `getProjectSnapshot(externalId)` returning the hours data: budget hours, spent hours (billable + non-billable split), and a per-(task, person) hours breakdown. Cost fields returned by the Harvest API (internal costs, invoiced amounts, fees) are deliberately NOT fetched or stored — see D9.

### New: per-project Harvest link + cached snapshot

- A Torii project may link to **one Harvest project** in addition to its Monday link. The link lives in a new nullable `projects.harvest_project_id` TEXT column. Existing `tracker_ref` (Monday-specific) is unchanged.
- New `project_harvest_snapshots` table caches the hours data per linked project, keyed on `project_id`. Refreshed every 30 min by the sync engine and on-demand by a Refresh button on the project detail page.
- Hours stored as `NUMERIC(10,2)` to preserve Harvest's 0.25h granularity. No monetary columns.

### Derived field: `Project.overBudget` becomes live

- Already on the API schema (currently always `false`). Becomes `snapshot.spent_hours > snapshot.budget_hours` (strict). When no snapshot exists, no budget is set, or budget is 0, `overBudget = false`. Computed in `serializeProject` via a LEFT JOIN — same pattern as the existing derived `projectType`.

### Web: /trackers page

- Add a "Harvest" connection card alongside the existing Monday card: status, Connect / Refresh / Test / Disconnect actions.
- After connecting, a "Link Harvest projects" table lists every Harvest project from `listProjects()`. Each row has a dropdown letting the admin link it to an existing Torii project (or "Skip"). Mirrors the Monday import flow's one-row-per-external pattern.

### Web: project detail page

- New `<HarvestPanel>` section card below the existing Monday details panel, rendered only when the project is linked to a Harvest project:
  - "View in Harvest →" link to the Harvest project URL (`portx.harvestapp.com/projects/<id>`).
  - Hours-only metric tiles: Total hours (with Billable / Non-billable subdivision), Budget hours, Budget remaining (signed hours + signed percentage + progress bar with overflow when > 100%), Last refresh timestamp. No cost or invoicing tiles.
  - Expandable per-(task, person) breakdown table: one row group per Harvest task ("03-Development", "00-Project Management", etc.) with each person's hours only. PM/SA/SC role badges shown when the person's name matches the Torii `details.project_manager` / `solution_architect` / `solution_consultant` field for that project. No cost column.
  - "Refresh from Harvest" button (PM-only).
- New `<OnBudgetChip>` rendered next to the existing State badge in the project header band: "On budget" (green) when `overBudget === false`, "Over budget −N%" (red) when true, where N is computed from hours: `Math.round((spent_hours - budget_hours) / budget_hours * 100)`.

### Web: Timeline page

- The existing inert `$` over-budget overlay on each project bar lights up for projects where `overBudget === true` (the schema field is already in place; only the data needs to flip).
- New filter-row toggle "Show budget". When on, each project bar renders a semi-transparent fill from the left edge with width = `min(100, spent/budget * 100)%`. Bars over 100% get a diagonal-striped red tail extending to the bar's right edge to indicate the overage visually.

## Capabilities

### New Capabilities

- `harvest-integration` — the cached snapshot per project, the OAuth flow, the read/refresh/link API surface, the derived `overBudget` computation, and the UI on the project detail page + timeline.

### Modified Capabilities

- `tracker-import` — extends `TrackerProvider` enum to include `harvest`; adds Harvest adapter + OAuth requirements; adds the bulk-link UI requirement. The Monday-specific merge engine and field-ownership rules are unaffected (Harvest is read-only, not a source of mergeable project metadata).
- `dashboard-views` — Timeline gains the "Show budget" toggle + functional over-budget overlay; project detail page gains the Harvest panel + budget chip in the header.
- `project-lifecycle` — `Project.overBudget` becomes derived from the Harvest snapshot (was always `false`).

## Impact

- **New code**:
  - DB: `harvest_project_id` column on `projects`, new `project_harvest_snapshots` table (hours-only), `harvest_account_id` column on `tracker_connections`.
  - API: HarvestAdapter, OAuth flow routes, `POST /api/projects/:id/harvest/link`, `DELETE /api/projects/:id/harvest/link`, `POST /api/projects/:id/harvest/refresh`, `GET /api/projects/:id/harvest`.
  - Web: HarvestPanel, OnBudgetChip, /trackers Harvest connection card, /trackers bulk-link table, timeline Show-budget toggle, over-budget overlay activation.
  - Shared types: HarvestSnapshot (hours-only), per-(task, person) line-item shape.
- **APIs**: 4 new endpoints. Project read response gains a populated `overBudget`; snapshot data lives on its own endpoint.
- **Schema**: 1 new table + 2 new columns.
- **Dependencies**: none new.
- **Env**: `HARVEST_CLIENT_ID`, `HARVEST_CLIENT_SECRET`, `HARVEST_REDIRECT_URI`. OAuth app is already registered at id.getharvest.com; only the env vars need to land. Documented in `docs/env.md`.

## Non-goals

- No editing of Harvest data from Torii (the panel is read-only).
- No invoicing workflow integration (Harvest's invoicing UI stays in Harvest).
- No time-entry creation from Torii (no logging hours).
- No daily/weekly cost timeline series — we store totals + per-(task, person) only.
- No multi-currency conversion (amounts treated as USD per the Harvest workspace's display currency).
- No retroactive budget editing — `budget_hours` reflects what Harvest reports at fetch time; if the budget changes in Harvest, the next sync overwrites the cached value.
- No alerting / Slack when a project crosses the over-budget threshold (a future change can subscribe to the derived flag).
- No bulk re-link UI — once a Torii project is linked to a Harvest project, changing the link requires unlinking first.
- No display of cost or invoicing data in Torii — that data stays in Harvest. The HarvestPanel surfaces hours-only metrics. See D9.

## Rollback plan

- Schema: drop `project_harvest_snapshots` and the two new columns. Additive only; no data on the existing `projects` table is touched.
- API: remove the new routes; existing `serializeProject` reverts to returning `overBudget: false` always.
- Web: revert the HarvestPanel + budget chip + timeline toggle. The existing over-budget `$` overlay returns to inert state.
- Remove `'harvest'` from `TRACKER_PROVIDERS` enum and from the OAuth env vars.

## Affected teams

- **PMO** — primary consumers of the budget chip and the Harvest panel. Process change: PMs are expected to glance at the chip during their weekly review and explain over-budget calls in the weekly risk update.
- **Engineering** — the per-(task, person) breakdown surfaces who's logging hours where, summarized to whole totals (no individual time entries, no per-person cost). Engineers should be aware that their Harvest hours are now sometimes visible in the PM-facing UI.
- **Finance** — unaffected. Invoicing and cost data stay in Harvest; Torii does not surface them.
- **Platform / IT** — three new env vars for the Harvest OAuth app registration. New scheduled job runs alongside the Monday sync (every 30 min).
