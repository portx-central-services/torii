## Why

`/risks` answers "what's red or amber this week?" today, but every PortX PMO interaction with the page hits the same five gaps:

1. **No trend signal.** A project that just went red and a project that's been red for 6 weeks read the same. The action you take on each is very different.
2. **No customer grouping.** Now that customers are first-class entities, scrolling a flat list of projects ignores the obvious clustering — "all 4 of Acme's projects are amber" is a different signal than "4 unrelated projects are amber."
3. **Cards are too tall.** Each RiskProjectCard renders `description`, `goToGreenPlan`, `latestUpdate`, `nextSteps`, `actionRequested` as stacked free-text blocks, plus a history accordion. Eyes have to do too much work to pull out the one field they actually need.
4. **PM weekly-update workflow is one-card-at-a-time.** A PM with 8 projects to update on Monday morning opens 8 cards, fills 8 forms, clicks 8 save buttons. There's no digest entry surface.
5. **Stale-Green isn't surfaced anywhere.** A project that's been Green for the last 6 weeks but hasn't had an update in 4 weeks is invisible — the page only shows currently-off-Green rows, and the dashboard's "No risk update this week" only catches the missed-current-week case, not the longer drift.

This change reshapes the page around those five gaps without rebuilding the underlying risk model. Same `ProjectRiskUpdate` entity, same weekly cadence, same upsert endpoint — better surfacing.

## What Changes

### Trend signal + weeks-stuck chip per project

Each project's card surfaces two small chips next to the RAG:

- **Trend chip** — derived from current vs. previous week. Values: `New` (no prior update), `↑ Worsened from <prev>`, `↓ Improved from <prev>` (e.g. Red → Amber), `Same`, or `Returned from Green` (currently non-Green but previous week was Green).
- **Weeks-stuck chip** — when the project has been at the same non-Green level for ≥2 consecutive weeks, render `Stuck N weeks at <level>`. Walk the project's history backward from the current week and count consecutive same-level entries.

Both are computed client-side from the existing per-project history fetch (`GET /api/projects/:id/risk-updates`). No new server endpoint needed.

### Group by customer

The Risks page renders projects clustered under customer headers (link to `/customers/:id`), in customer-name order. Customers with no name and projects with `customer_id = null` cluster under a trailing "No customer" group. Each customer header carries a small count chip ("3 projects · 1 red · 2 amber").

The `GET /api/risks` response gains `customerId` and `customerName` per row so the page can group server-shaped data without a second round-trip.

### Card details as a two-column label/value table

The per-project card's free-text fields now render as a compact 2-column table:

| Description / History | (free-text) |
| Go-to-green plan | (free-text) |
| Next steps | (free-text) |
| Action Requested | (free-text) |

The history accordion ("Previous weeks") moves into the **Description / History** row as a "View N earlier weeks" link inline, keeping the card vertically tight when collapsed. The current week's `latestUpdate` field is folded into the **Description / History** cell (above the history link), so the table stays at four rows.

Edit-mode (PM only) stays the same form fields, just laid out vertically with the same labels so users see the same shape during and after edits.

### PM bulk weekly update

A PM-only **"Update my week"** button at the top of `/risks` opens a side panel listing every project where the current viewer is `ownerId`, `projectManagerId`, `solutionArchitectId`, or `solutionConsultantId` AND that project does NOT yet have a `ProjectRiskUpdate` for the current ISO week (any state, including projects currently Green). Each row:

- Project name + phase chip + customer link
- Inline `RagLevel` selector
- Inline `RiskState` selector (Blocked / Inform; only required when RAG != Green)
- One-line `latestUpdate` text input
- Optional `nextSteps` text input

A single "Save all" button POSTs each row sequentially. Errors are surfaced per-row so partial saves are visible. Closing the panel after a successful save invalidates the risks query so the main page reflects the new state immediately.

This does NOT replace the per-project "Edit this week" affordance — the bulk surface is for fast triage; per-project edit stays available for fuller updates with the full field set.

### Stale-Green section

A new section below the at-risk groups, titled **"Stale updates"**, lists projects whose most-recent `ProjectRiskUpdate` is Green (or where the latest update is more than 2 ISO weeks old, regardless of level). Sorted by `weeksSinceLastUpdate` descending. Each row shows project name (link), customer, last RAG + week, `weeksSinceLastUpdate` chip, and a PM-only "Update now" button that opens the bulk-update panel pre-filled with this project.

The section reuses the existing `GET /api/risks?include=stale` endpoint extension (rather than a new endpoint) — add a query parameter that includes stale-Green rows in a separate `stale: [...]` array alongside the existing array of at-risk rows.

### Out of scope (deferred — called out in spec non-goals)

- Risk-type breakdown chart / chips (filter by Technical / Schedule / Resourcing etc.). Useful but a separate-shaped chunk of work.
- Notifications / digest export. Surfacing is enough for v1.
- Heatmap or sparkline trend over many weeks. The trend chip captures week-over-week; full visualization is its own change.
- Stale-threshold configurability. Hardcoded to 2 ISO weeks; admin-tunable is a future enhancement.
- Filter UI beyond customer grouping. Sort is the default; RAG / state / phase chip filters are a future enhancement.

## Capabilities

### Modified Capabilities

- `risk-tracking` — extends `GET /api/risks` to include `customerId` / `customerName` and a `stale[]` array when `?include=stale`; modifies the Risks page requirement to cover customer grouping, trend + weeks-stuck chips, two-column card details, PM bulk-update panel, and the stale-Green section.

## Impact

- **New code**: extension to `/api/risks` response shape (added fields + optional `stale[]` array), new bulk-update flow (UI only — uses existing per-project upsert endpoint), card-detail layout refactor, customer grouping wrapper on the page.
- **DB**: no schema changes; no migrations.
- **API contracts**: `GET /api/risks` response gains `customerId` / `customerName` per row and an optional `stale[]` array under `?include=stale`. Existing consumers (Portfolio Dashboard) read the same row shape with two extra fields — backwards compatible.
- **Env**: no new env vars.
- **Dependencies**: no new packages.

## Non-goals

- No new risk-update fields (description, goToGreenPlan, latestUpdate, nextSteps, actionRequested all stay as today).
- No new role permissions. Edit gating stays "PM can edit current week."
- No real-time updates. Standard React Query refetch policy.
- No backwards-compat shim for the response-shape change — every consumer of `/api/risks` updates in lockstep.

## Rollback plan

Pure additive change. To roll back: revert the response-shape addition, restore the previous Risks page layout, drop the bulk-update panel. No data state changes.

## Affected teams

- **PMO** — primary users. The weekly Monday-morning ritual gets faster (bulk update) and reads more honestly (trend + weeks-stuck signal).
- **Engineering** — no infra changes.
- **Customer-aware reporting** — once the Risks page groups by customer, the same clustering can drive a future "customer-risk summary" surface without further data work.
