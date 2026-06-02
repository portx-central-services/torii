## 1. API: aggregation endpoint

- [x] 1.1 Add `apps/api/src/routes/dashboard.ts` exporting `registerDashboardRoutes({ db })`. Auth: any authenticated user (`requireUser`).
- [x] 1.2 Endpoint: `GET /api/dashboard/summary`. Single response object with these top-level keys: `kpis`, `thisWeekRag`, `schedulePressure`, `noRiskUpdate`, `slipping`, `phaseCounts`.
- [x] 1.3 KPIs:
  - `active` = `COUNT(*) WHERE state != 'Done'`
  - `atRisk` = `COUNT DISTINCT projectId` from the latest-week-per-project RAG that is non-Green AND state != 'Done' (reuses the same `DISTINCT ON (project_id) ORDER BY week_of DESC` shape as `/api/risks`)
  - `overBudget` = `COUNT(*) WHERE state != 'Done'` joined with snapshot where `spent_hours > budget_hours > 0`
  - `launchingSoon` = projects with `key_dates.target_go_live` set, within 30 days of today, state != 'Done'
  - `avgSlipDays` = average `(actual_go_live - baseline_go_live)` across Done projects with BOTH set (positive or negative — historical accuracy)
  - `peopleInvolved` = `COUNT DISTINCT` Person id appearing as PM/SA/SC FK across active projects
- [x] 1.4 This-week RAG counts: same DISTINCT-ON shape as KPI atRisk but bucketed by `ragLevel`. Include prevRed/prevAmber/prevGreen for the prior ISO week (reuses `isoWeekMondayUTC` minus 7 days).
- [x] 1.5 Schedule pressure: top 30 projects whose `target_go_live` is within 30 days of today AND state != Done, ordered ascending by date. For each: `projectId`, `projectName`, `targetGoLive` (ISO), `daysUntil` (integer), `phase`, `ragLevel` (latest non-Green if any, else null), `overBudget`.
- [x] 1.6 No-risk-update list: active projects (state != Done) with NO `ProjectRiskUpdate` row for the current ISO week. For each: `projectId`, `projectName`, `latestRagLevel` (most recent overall, or null), `weeksSinceLastUpdate` (null if no prior updates). Sort: worst latest RAG first (Red → Amber → null → Green), then by `weeksSinceLastUpdate` descending.
- [x] 1.7 Slipping list: projects with `target_go_live > baseline_go_live` AND state != Done. Sorted by `slipDays` descending. For each: `projectId`, `projectName`, `baselineGoLive`, `targetGoLive`, `slipDays`. Limit 30.
- [x] 1.8 Phase counts: `GROUP BY phase` over active projects, returned as `Record<Phase, number>`. Include 0 entries for phases with no active projects so the UI's stacked bar can render predictably.
- [x] 1.9 Register the route module in `apps/api/src/app.ts`.

## 2. Shared schema for the response

- [x] 2.1 Add `DashboardSummarySchema` (Zod) in `packages/shared/src/schemas.ts` mirroring the response shape above; export `DashboardSummary` type.

## 3. Web API client

- [x] 3.1 Add `getDashboardSummary()` helper to `apps/web/src/api/endpoints.ts` returning the new type.

## 4. Web: dashboard page

- [x] 4.1 Add `apps/web/src/routes/dashboard.tsx` exporting `<PortfolioDashboardPage>`. Fetch the summary via `useQuery(['dashboard-summary'], endpoints.getDashboardSummary)`.
- [x] 4.2 Top: page header "Portfolio" with a one-line subtitle "Monday morning briefing: what's at risk, what's launching, what needs attention."
- [x] 4.3 **Hero KPI band** — `<KpiTile>` × 6 in a grid:
  - Active → `/projects` (no query — the list opens to all)
  - At risk → `/risks`
  - Over budget → `/projects` (with a comment in code: closest filter today is `?tile=blocked`; correlate-not-equal — see design D5)
  - Launching ≤ 30d → `/projects`
  - Avg slip → `/projects` (Done filter — closest existing match)
  - People involved → no link (rendered as static value with a `cursor: default` style)
- [x] 4.4 **This week's risk picture** card — Red / Amber / Green chips in a row with current count + small subtext `was N`. Clicking Red or Amber routes to `/risks`. Green is non-interactive.
- [x] 4.5 **Schedule pressure** card — table or vertical list. Each row: project name (link to `/projects/:id`), `target_go_live`, days-until, phase badge, RAG chip (or em-dash), over-budget chip (when applicable). Empty state: "Nothing launching in the next 30 days."
- [x] 4.6 **Needs attention** — two side-by-side cards in a single row (stack vertically on narrow viewports):
  - **No risk update this week**: list rows: project name (link), latest RAG (or "no prior update"), "N weeks ago" (or "never")
  - **Slipping**: list rows: project name (link), `baseline_go_live`, `target_go_live`, slip days (red text)
- [x] 4.7 **Phase distribution** card — horizontal stacked bar, one segment per phase, each segment width proportional to the phase's count. Use the existing `PHASE_BG` color map from the Timeline page (factor into shared helper if needed). Tooltip on hover showing `<PhaseLabel>: N projects`. Click a segment → `/projects?tile=...` — except `/projects` doesn't have a phase-tile filter today, so click navigates to `/projects` and the user uses the existing phase dropdown there.
- [x] 4.8 Loading state: skeleton-ish placeholders for the hero band and section cards. Empty/error state: render a single muted message; the page still loads its layout.

## 5. Routing + nav

- [x] 5.1 Replace the `<Route index element={<Navigate to="/projects" replace />} />` in `App.tsx` with `<Route index element={<PortfolioDashboardPage />} />`.
- [x] 5.2 Add a `Dashboard` `<NavLink to="/">` entry to `apps/web/src/components/NavShell.tsx` as the **first** entry, before Timeline.
- [x] 5.3 Update the breadcrumb label switch in NavShell so `/` reads "Dashboard" (not "Projects").

## 6. CSS

- [x] 6.1 Reuse `.kpi`, `.kpi-row`, `.kpi-label`, `.kpi-value`, `.kpi-sub`, `.kpi-active` classes from the Projects-page tiles for the hero band — the visual language is the same.
- [x] 6.2 Add `.dashboard-stacked-bar` + `.dashboard-stacked-bar-segment` for the phase-distribution component.
- [x] 6.3 Small responsive layout adjustments: 2-column "Needs attention" row collapses to 1-column below ~720px.

## 7. Spec deltas

- [x] 7.1 `dashboard-views` — Portfolio Dashboard requirement (`/` route, six KPI tiles, section list, click-through behaviors), `GET /api/dashboard/summary` requirement, modification to the Navigation shell requirement (Dashboard link first).

## 8. Verification

- [x] 8.1 `pnpm --filter @torii/api test` green
- [x] 8.2 `pnpm --filter @torii/web exec tsc --noEmit` clean
- [x] 8.3 `pnpm --filter @torii/web build` succeeds
- [ ] 8.4 Manually: open `/` — dashboard renders; numbers look plausible against your knowledge of the portfolio
- [ ] 8.5 Manually: click each KPI tile (where clickable) and confirm the drill-down lands correctly
- [ ] 8.6 Manually: a project with no risk update for the current week appears in "Needs attention → No risk update this week"
- [ ] 8.7 Manually: a project whose `target_go_live` has slipped past `baseline_go_live` appears in "Needs attention → Slipping" with the correct slip-days delta
- [ ] 8.8 Manually: the schedule-pressure card lists projects in the right order (ascending `target_go_live`) and surfaces RAG / over-budget chips correctly
- [ ] 8.9 Manually: the phase-distribution bar renders proportional widths; hovering a segment shows the count; clicking navigates to `/projects`
- [ ] 8.10 Manually: confirm the nav "Dashboard" link is the first entry and routes to `/`
