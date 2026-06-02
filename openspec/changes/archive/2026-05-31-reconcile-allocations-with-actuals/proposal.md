## Why

Torii has tracked **planned hours** for almost as long as it's existed: `allocations.pct × person.defaultCapacityPct × 40h/week × weeks_in_range`. With Harvest integration, it now also tracks **actual hours** per (project, person). But the two signals **never join in the UI** — the AllocationsPanel shows planned, the HarvestPanel shows actual, and a PMO has to mentally cross-reference two tables to answer the question "is this person doing the work we said they would?"

This change closes the loop: a project's detail page gets an **Allocations vs. Actuals** panel that displays planned hours next to actual hours per allocated person, color-coded by variance. A person's page gets the same view across all their projects. The /trackers page gets a **Harvest user linking table** so admins can populate the `Person.harvest_user_id` bridge that #3 added but did not auto-fill.

This is the moment Torii stops being a dashboard of dashboards and becomes a **PMO instrument**: "Aaron is allocated 50% to project X, but Harvest shows he's at 10% — what's going on?" is now a question you can ask the tool, not just the team.

## What Changes

### Harvest user linking

- New endpoint `GET /api/tracker/harvest/users` (admin) — lists every active Harvest user from `GET /v2/users` with `{ harvestUserId, name, email, linkedToiriPersonId, linkedToiriPersonName }`. Mirrors the existing `/api/tracker/harvest/projects` endpoint that powers the bulk project-link UI.
- New endpoints `POST /api/people/:id/harvest-link` (`{ harvestUserId }`) and `DELETE /api/people/:id/harvest-link` to set/clear `Person.harvest_user_id` — admin-only, mirrors the project-link endpoints.
- New `<HarvestUserLinkTable>` on `/trackers`, rendered below the existing `<HarvestLinkTable>` when a Harvest connection is active. One row per Harvest user; a dropdown per row picks the Torii Person to link (or "Skip"). Submitting calls the link endpoint.

### Per-project reconciliation panel

- New `<ReconciliationPanel>` rendered on the project detail page, below the AllocationsPanel and below the HarvestPanel when a Harvest snapshot exists. Visible to every authenticated user (no edit affordances in this change).
- For each person allocated to the project (via the existing `allocations` table), display:
  - **Planned hours**: `sum across this person's allocations on this project of (pct × person.defaultCapacityPct × 40h × weeks_in_range / 100²)`
  - **Actual hours**: total from the Harvest snapshot's per-(task, person) breakdown for this person (resolved via `Person.harvest_user_id`)
  - **Variance**: actual − planned (signed hours and signed %)
  - **Status chip**: green when |variance| ≤ 10%, amber when ≤ 25%, red when > 25%, neutral when "no Harvest link"
- People in the Harvest breakdown who aren't allocated in Torii (e.g., dev rotated in but the PM hasn't updated allocations) are listed below in a "Logged but not allocated" section, so the absence is visible.
- The panel is purely a derived view — no DB writes. All math runs client-side using data the page already fetches (allocations + Harvest snapshot).

### Per-person reconciliation section

- New "Allocations vs. Actuals" section on `/people/:id` below the existing role sections. Shows this person's lifetime planned vs. actual hours, broken down per project they're allocated on.
- Backed by a new endpoint `GET /api/people/:id/reconciliation` that joins `allocations` + every linked project's Harvest snapshot and returns per-project rows: `{ projectId, projectName, plannedHours, actualHours, variance, variancePct, linkedToHarvest }`.
- Same color-coded variance chip as the per-project view.

### What's deliberately NOT in this change (deferred)

- **Weekly granularity.** The Harvest snapshot is project-lifetime totals, not weekly. "Is this person over-allocated *this week*" needs a separate per-week Harvest pull (a `/v2/time_entries?from=…&to=…` time-windowed sync) that's bigger than this change. The reconciliation we ship here is **lifetime totals** per (person, project) — enough to surface "we allocated 200h, they logged 50h" but not "they're at 80h this week vs. 40h planned." A follow-up change can add weekly. The UI here is shaped so weekly slices can drop in later without restructuring.
- **Auto-link Harvest user by name.** Admin-driven manual linking only, same rationale as #3's "no fuzzy matching" — false positives in finance-adjacent data are worse than the friction of an admin clicking a dropdown.
- **Editing allocations from the reconciliation view.** Read-only; the existing AllocationsPanel is still the edit surface.

## Capabilities

### Modified Capabilities

- `capacity-planning` — adds the reconciliation math + per-person reconciliation endpoint; defines the variance buckets (green / amber / red / neutral).
- `harvest-integration` — adds the Harvest user listing endpoint, the per-person Harvest-link endpoints, and the bulk-link table on /trackers.
- `dashboard-views` — adds the `<ReconciliationPanel>` on project detail; adds the "Allocations vs. Actuals" section on `/people/:id`.

## Impact

- **New code**: 2 new endpoints (Harvest user list + per-person reconciliation) + 2 new mutation endpoints (link / unlink Person → Harvest user); new `<ReconciliationPanel>` component; new `<HarvestUserLinkTable>` component; new section on `/people/:id`.
- **DB**: no schema changes — `Person.harvest_user_id` already exists from #3.
- **API contracts**: 2 new GET endpoints + 2 new mutations; existing endpoints unchanged.
- **Env**: no new env vars.
- **Dependencies**: no new packages.

## Non-goals

- No weekly granularity for actuals — totals only. Document the path to weekly without committing to it in this change.
- No automatic Harvest-user → Person linking. Admin chooses the link manually.
- No Slack / email alerts when variance > 25%. The chip surfaces it visually; alerts are a future change.
- No "predicted future hours" or burn-rate projection. Past totals only.
- No editing of allocations from the reconciliation view.
- No reconciliation for project owners (who often log no hours by design). The view limits to people with an `Allocation` row on the project; the "Logged but not allocated" section surfaces the inverse case.

## Rollback plan

- Remove the new endpoints + components. No schema migration to reverse — `Person.harvest_user_id` stays as it's already shipped from #3 and is harmless when unused.

## Affected teams

- **PMO** — primary users. The reconciliation panel is the first place where planned and actual hours are visible together. Expect immediate "huh, that's not what I expected" reactions; that's the point.
- **Engineering** — the per-(task, person) breakdown that #harvest-integration already caches is now visible in a place engineers may notice. No new visibility into individual time entries.
- **Platform / IT** — one admin step required after the change ships: an admin needs to walk through `/trackers` → "Link Harvest users" once to populate `Person.harvest_user_id` for the team. Without that, the reconciliation panel shows "no Harvest link" instead of a variance chip for every person.
