## Constraints

- The portfolio is ~200 active projects + ~64 People at PortX's current scale. Aggregations can run server-side on every request without trouble; no caching layer needed in this change.
- Every signal the dashboard needs is already in the API. The new endpoint is the one place that joins them; the page is otherwise pure UI.
- The `Project.overBudget` derived field is already computed by `serializeProject` via a LEFT JOIN on `project_harvest_snapshots`. The dashboard endpoint can reuse the same join shape.

## Decisions

### D1 — `/` becomes the dashboard, not a redirect

The redirect-to-`/projects` setup made sense before Torii had cross-cutting signals. Now that risks, budget, allocations, and slip live in one tool, landing on a list of 200 rows hides the synthesis users actually open Torii for. Replacing the redirect is a small behavior change that signals "this is your starting point now."

For users who specifically want the projects list, the nav link is one click away and keeps its existing search/filter state across visits within a session.

### D2 — Single aggregation endpoint, not five small ones

Rendering six independent sections from six independent `useQuery` calls would mean six waterfalls on cold load and a flickery UX as each section pops in. One `GET /api/dashboard/summary` returns the whole bundle; the page renders once.

The endpoint is small SQL (a few aggregate queries, no joins beyond what we already do on the project list). If it grows past 100ms in practice, we can shard sections OR introduce a 1-minute server cache — but neither is needed at our scale.

### D3 — Hero KPIs link to existing drill-downs, not to dashboard-internal modals

Every number on the dashboard is a navigation hook. Click "At risk: 12" → land on `/risks` with all 12 already listed. Click "Launching ≤ 30d: 8" → land on `/projects` (eventually with a `?upcoming=30d` filter — see D5). The dashboard doesn't duplicate the per-page UI; it's an index.

This is intentional: it makes the dashboard easy to ship (no new filter UIs) and gives a clear answer to "where do I do the work" — never on the dashboard, always one click into a drill-down.

### D4 — "No risk update this week" is the prioritized stale-signal

Of the stale signals discussed in the proposal (no risk update, no Harvest activity, slipping past baseline), only **no risk update** has clean week-on-week data without further schema work. Harvest activity needs `last_activity_at` on the snapshot which we don't track yet. Slipping uses `baseline_go_live` vs. `target_go_live` and ships as its own section in this change.

The "no risk update" cutoff is **current ISO week** (Monday-anchored UTC, same definition `iso-week.ts` already uses). Anything past that — "no update in 14 days" — would need a different anchor; we ship the simpler weekly version first.

### D5 — Hero Over-budget tile links to `/projects?tile=blocked`, with a comment

The existing Projects-page tile filters are: Active / On track / At Risk / Blocked / Go-Live ≤ 60d. There's no `over-budget` tile filter yet. Rather than block this change on adding a 7th tile + URL state to the Projects page, the dashboard's Over-budget tile links to `?tile=blocked` (which is loosely correlated — many over-budget projects are also blocked) as a stopgap. The tile's label still reads "Over budget" so the click target is honest about what it counts; the drill-down just lands on the closest existing filter.

This is the only honest-but-imperfect link on the dashboard. A future change adds a real `?tile=over-budget` filter on /projects.

### D6 — Slip metric definition: `target_go_live − baseline_go_live` when both set, only flagged when positive

The "slipping" section surfaces projects where the current target has slipped *past* the original baseline. Negative slip (target moved earlier than baseline — meaning we pulled in the launch) is not flagged; it's a good signal but not the one the dashboard is looking for. The average-slip KPI in the hero band uses **Done projects with both dates set** so it reflects historical accuracy, not future projections.

Projects without `baseline_go_live` set are silently excluded from both slip computations — they have no anchor.

### D7 — Phase distribution is a horizontal stacked bar, not a pie

Pie charts make per-segment comparison hard. A horizontal stacked bar gives the same total-area information AND lets the reader compare adjacent segments at a glance. Each segment uses the same phase color palette the Timeline page already uses, so the dashboard reads consistently with the existing view.

### D8 — Dashboard fetches once per visit; React Query default refetch policy applies

No special refresh strategy. React Query refetches on window focus by default; that's enough to keep numbers from going stale while a delivery lead has the tab open. A "Refresh" button is not needed — the data updates when they return to the tab.
