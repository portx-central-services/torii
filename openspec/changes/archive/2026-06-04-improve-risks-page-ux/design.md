## Constraints

- `ProjectRiskUpdate` is keyed by `(projectId, weekOf)` — one snapshot per project per ISO week. That stays.
- `/api/risks` returns one row per currently-off-Green project. Card-level history is fetched separately per card via `/api/projects/:id/risk-updates`. That stays — the per-card fetch gives us free history without bloating the index endpoint.
- Customer rows now exist as first-class entities (`add-customer-entity` shipped earlier). Projects FK into customers; not every project has one yet (admin work in progress via `/trackers`).
- ISO weeks are Monday-anchored UTC, already centralized in `apps/api/src/lib/iso-week.ts` and `packages/shared/src/iso-week.ts`. Reuse, don't duplicate.

## Decisions

### D1 — Trend + weeks-stuck computed client-side

The per-card history fetch already returns the project's full `ProjectRiskUpdate` array. Computing trend ("current vs. previous-week level") and weeks-stuck ("how many consecutive weeks at this level walking backward from today") is a O(history) walk in the browser. No server work, no new endpoint, no caching layer.

Server-side computation would arguably be cleaner (one query instead of N), but the per-card history is already fetched for the existing "Previous weeks" accordion, so the cost is zero.

### D2 — Customer info on `/api/risks` response, not a second fetch

The Risks page is going to group rows by customer. The naïve approach — render risks, then fetch the per-customer rollup for each — would mean N+1 round trips. Instead we add `customerId` + `customerName` to the existing `/api/risks` row shape via the project's `customer` relation. One round trip, page renders immediately.

Backwards-compatibility: existing consumers (Portfolio Dashboard's "This week's risk picture" KPI counts) don't read those fields, so adding them is non-breaking.

### D3 — Card details as a four-row label/value table, not five

We have five free-text fields on `ProjectRiskUpdate`: `description`, `latestUpdate`, `goToGreenPlan`, `nextSteps`, `actionRequested`. The user-requested layout has four rows: **Description / History**, **Go-to-green plan**, **Next steps**, **Action Requested**.

The merger: the **Description / History** row carries `description` at the top (the standing situation) and the new week's `latestUpdate` directly below it under a small "This week:" label, with the "View N earlier weeks" history link as the bottom item. That keeps the table scannable as four rows while preserving every field.

`latestUpdate` was awkwardly distinct from `description` to begin with — they're both narrative fields. Folding them into the same cell reads more naturally without losing the data.

### D4 — Bulk update is a side panel, not a separate route

A `/risks/update-week` route would be cleaner architecturally but worse UX — the PM is already on `/risks`, the digest is a small spike of activity, and closing the panel returns them to the same grouped view they were just in. A modal would block the page; a side panel keeps both visible.

The panel is PM-only. It lists every project the current viewer holds any role on (owner / PM / SA / SC) where the current ISO week's `ProjectRiskUpdate` is missing. Even Green projects show up — the point is "give me one row per project I need to update this week."

Saves are sequential (not parallel) to surface per-row errors clearly. With <20 typical rows and a small payload, the wall-clock cost is fine. On any single-row error, the panel keeps the row visible with the error message; successful rows disappear.

### D5 — Stale-Green via `?include=stale`, not a new endpoint

Adding `GET /api/risks/stale` is the obvious alternative but doubles the surface area for one additional list. Instead `GET /api/risks?include=stale` returns:

```ts
{
  atRisk: [/* same row shape as today, just with customerId/customerName added */],
  stale: [/* {projectId, projectName, customerId, customerName, lastRagLevel, lastWeekOf, weeksSinceLastUpdate} */],
}
```

When the query parameter is absent, the response remains an array (existing shape) for backwards compatibility. When present, the response is the object form above. Old clients keep working; new client opts in.

Stale threshold: hardcoded to **2 ISO weeks** in the API. Configurability deferred.

### D6 — Default to grouped-by-customer; no toggle

A toggle between grouped and ungrouped views adds UI surface for marginal benefit. Grouping by customer matches the rest of Torii's data model (customer page, people index expander). Projects with no customer surface in a trailing "No customer" group so the unmapped tail is visible but doesn't dominate the named-customer rows.

If the team later prefers ungrouped, a one-line toggle is easy to add. For now: opinionated default.

### D7 — Trend chip semantics

Per project, comparing `current` and `previous` from the history array:

- No `previous` → **"New"**
- `previous.ragLevel === 'Green'` AND `current.ragLevel !== 'Green'` → **"Returned from Green"**
- `current.ragLevel === previous.ragLevel` → **"Same"** (plus weeks-stuck counter if ≥2)
- `current` worse than `previous` (Amber→Red, Green→Amber, Green→Red) → **"↑ Worsened from <prev>"**
- `current` better than `previous` (Red→Amber, Red→Green is impossible since the project wouldn't be on the page) → **"↓ Improved from <prev>"**

The ranking for "worse than" is `Green < Amber < Red`.

### D8 — Weeks-stuck counter only when ≥2

A "1 week" chip is noise (every fresh red trivially qualifies). We only render the weeks-stuck chip when the count is 2 or more. That keeps the visual signal meaningful and the cards uncluttered.

### D9 — No mass refactor of the existing RiskProjectCard component for the project detail page

The same `<RiskProjectCard>` is rendered on `/projects/:id` (per the existing `Risk update entry from the project detail page` requirement). We update the component so the new 2-column table layout applies there too — there's no reason it should look different. Trend / weeks-stuck chips also render on the detail page card. Bulk update is /risks-only.
