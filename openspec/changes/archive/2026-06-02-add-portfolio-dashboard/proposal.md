## Why

Every Monday a delivery lead has to answer three questions: **what's at risk this week, what's launching soon, what needs attention.** Torii currently surfaces those answers across **six different pages** — `/risks`, `/projects`, `/timeline`, `/capacity`, `/trackers`, and a fanout of per-project detail pages. Each is well-shaped on its own; together they're a scavenger hunt.

This change adds a **portfolio dashboard at `/`** — the synthesis layer that's been missing. Every signal we've shipped (risk RAG, budget variance, phase, key dates, allocations-vs-actuals) is already in the API; the dashboard re-projects them as a single weekly briefing. Every number on the page is a clickable link into the drill-down view that already exists, so it's a navigation hub as much as a status summary.

**No new data sources** — pure UI + one server-side aggregation endpoint that does the joins in SQL so the page renders in one round trip.

## What Changes

### `/` becomes the dashboard, not a redirect

Today `/` redirects to `/projects`. After this change, `/` renders the dashboard directly. The nav order becomes **Dashboard → Timeline → Risks → Projects → Capacity → Trackers**; the Dashboard link is visible to every authenticated user.

### Sections (top to bottom)

**1. Hero KPI band** — 6 clickable tiles:

- **Active** (state ≠ Done) → `/projects?tile=active`
- **At risk** (latest weekly RAG ≠ Green AND state ≠ Done) → `/risks`
- **Over budget** (`overBudget === true`) → `/projects?tile=blocked` (closest existing filter; see non-goals re: `?tile=over-budget`)
- **Launching ≤ 30d** (`target_go_live` set, within 30 days, state ≠ Done) → `/projects`
- **Avg slip** (`actual_go_live − baseline_go_live` across Done projects with both set, in days) → `/projects` filtered to Done
- **People involved** (distinct PM / SA / SC counts across active projects) → `/people` (currently no index page — link is informational; reach goal is a future `/people` list)

**2. This week's risk picture** — a horizontal split showing Red / Amber / Green counts for the current ISO week, with the previous-week count as small subtext per chip. Clicking Red or Amber navigates to `/risks` (the existing page already lists only non-Green entries). Green isn't clickable.

**3. Schedule pressure** — a vertical list of every project with `target_go_live` within 30 days, sorted ascending by date. Each row: project name (link), date, days-until, phase badge, RAG chip (when an at-risk update exists), over-budget chip. Empty state when nothing's launching in the window.

**4. Needs attention** — two side-by-side stacks:

- **No risk update this week** — active projects (state ≠ Done) with NO `ProjectRiskUpdate` for the current ISO week. Sorted by latest weekly RAG worst-first; the most-at-risk projects without a fresh update bubble up.
- **Slipping** — projects where `target_go_live` has shifted past the original `baseline_go_live` AND state ≠ Done. Sorted by slip magnitude (days). Shows the slip in days alongside both dates.

**5. Phase distribution** — a horizontal stacked bar of active projects bucketed by phase, using the existing phase color palette. Hover (or tap) a segment → tooltip with the count; click a segment → `/projects` filtered to that phase.

### New endpoint: `GET /api/dashboard/summary`

Single endpoint that returns everything the dashboard needs in one call:

```ts
{
  kpis: { active, atRisk, overBudget, launchingSoon, avgSlipDays, peopleInvolved },
  thisWeekRag: { red, amber, green, prevRed, prevAmber, prevGreen },
  schedulePressure: Array<{ projectId, projectName, targetGoLive, daysUntil, phase, ragLevel | null, overBudget }>,
  noRiskUpdate: Array<{ projectId, projectName, latestRagLevel | null, weeksSinceLastUpdate | null }>,
  slipping: Array<{ projectId, projectName, baselineGoLive, targetGoLive, slipDays }>,
  phaseCounts: Record<Phase, number>,
}
```

All accessible to any authenticated user (read-only). The endpoint is the only new server-side work in this change — every page section feeds off this one fetch.

### Out of scope (deferred — called out in spec non-goals)

- Stale Harvest activity ("nobody logged hours in 14+ days on this project") — needs `last_activity_at` on the snapshot which we don't track today. Future change can layer.
- Per-person capacity-this-week ("anyone over-allocated") — needs weekly Harvest pulls (the upcoming Phase 2 of #1).
- Sparklines / week-over-week trends — would need a small time-series cache. The "prev-week" RAG counts ship here as a single-period delta; not a full trend.
- Customizable dashboard layout / saved views / role-targeted dashboards — one shape for everyone in this release.
- Real-time updates — page fetches on load and on React Query's standard refetch policy. No websockets.

## Capabilities

### Modified Capabilities

- `dashboard-views` — adds the `/` Portfolio Dashboard requirement (sections, KPI math, click-through behaviors) and the `GET /api/dashboard/summary` aggregation endpoint requirement; modifies the existing `Navigation shell` requirement to add the Dashboard link at the front of the order.

## Impact

- **New code**: one new API endpoint with a couple of aggregation queries; one new web page (`<PortfolioDashboardPage>`); one new nav entry; small CSS additions for the KPI tiles and the section cards.
- **DB**: no schema changes; no migrations.
- **API contracts**: one new GET endpoint; existing endpoints unchanged.
- **Env**: no new env vars.
- **Dependencies**: no new packages.

## Non-goals

- No new aggregation tables. The endpoint joins live data on every request; with ~200 projects the round-trip stays under 100ms in practice.
- No filtering / personalization on the dashboard itself. Filters live on the drill-down pages (`/projects`, `/risks`, `/timeline`) where they already exist.
- No editing affordances on the dashboard. Pure read-only synthesis.
- No `/people` index page. The hero "People involved" tile is informational only until a future change adds a list view.
- No "tile=over-budget" filter on the Projects page in this change. The existing tiles cover state-based filters; the dashboard's Over-budget tile links to the closest match (`tile=blocked` shows blocked projects which is often correlated). A future change can add `tile=over-budget` if it proves useful.
- No layout configurability. Sections render in a fixed order; tiles render in a fixed order.

## Rollback plan

- Remove the new endpoint, the new page, the new nav entry. Restore the `/` redirect to `/projects`. Additive only — no data state changes.

## Affected teams

- **PMO** — primary users. Expect a behavior change: opening Torii lands on the dashboard instead of the projects list. The dashboard intentionally synthesizes what was previously spread across six pages, so the Monday morning ritual gets shorter.
- **Engineering** — the new aggregation endpoint is the first place we run summary SQL across multiple tables. Future "exec reporting" features can extend the same endpoint or sit alongside it.
- **Platform / IT** — no infra changes.
