## Constraints

- ~64 people total at PortX scale. The overview endpoint returns one row per Person plus a small `currentProjects` array — payload size in the low tens of KB, no pagination needed.
- The Harvest sync already pages through `/time_entries` per project; the 30-day aggregation is a side-effect of work already happening, not a new API surface.
- `Person.harvest_user_id` is the bridge between Torii and Harvest's per-entry `user.id`. People without that link can't have a 30-day total computed — surface `null` not `0`.
- The page is read-only. All edits live on `/people/:id` (gated by self-or-admin per the previous change).

## Decisions

### D1 — Cache the 30-day total on `Person`, refresh during the existing sync

The naïve alternative is "compute on read" — for every `/api/people/overview` call, walk every project's `harvest_projects.raw.timeEntries` and bucket by user. We rejected this because:

- `raw` is debug data and not API-surface contract. Reading it for production signal couples the index page to an implementation detail of the snapshot.
- Walking ~60 projects × hundreds of entries on every page load is wasteful when the data changes hourly at most.

Caching on `Person` makes the read O(N) over people with a single column scan. The cache freshness is bounded by the Harvest sync interval, which is already accepted as "good enough" for every other Harvest-derived signal in Torii.

The `billedHoursAsOf` timestamp is non-optional companion data: without it, the UI can't honestly say "as of last sync" on stale values. We surface a tooltip with relative time so the reader knows whether they're looking at a fresh or week-old number.

### D2 — Compute the 30-day total in one sync pass, not per-project

The Harvest sync engine already calls `getProjectSnapshot()` per project, which pages through `/time_entries?project_id=X`. To collect the per-person 30-day total without a separate Harvest API call, the sync engine gathers ALL the per-project time-entry arrays (which `getProjectSnapshot()` already returns via the `raw` payload), filters by `spent_date >= today − 30d`, buckets by `user.id`, and upserts the totals on the matching `Person` rows at the end of the sync loop.

This means the 30-day total is a "tail-of-sync" computation, not embedded inside the per-project loop. We do it AFTER all projects are refreshed so we have the full picture. People whose `harvest_user_id` doesn't appear in any time entry get their 30-day total updated to `null` (so leavers don't keep stale values).

### D3 — `GET /api/people/overview` is a separate endpoint, not bolted onto `GET /api/people`

Same reasoning as the `/api/people/:id/workload` decision: `GET /api/people` returns lightweight Person rows for pickers, dropdowns, link tables, and the admin UI. Loading workload data (committed pct, current projects, billed hours) on every consumer would be wasteful. The overview endpoint is the index-page's purpose-built read.

### D4 — Row expander is local state, not URL-driven

Expanding a row to show the person's current projects is ephemeral — there's no "deep link to a specific person expanded" use case. Keeping it in component state avoids cluttering the URL with `?expanded=p1,p2,p3` and avoids the navigation friction of expanded state resetting on every back/forward.

If we ever want shareable expanded state, a future change can add it without touching the schema.

### D5 — Capacity column is composite, not split

We considered three separate columns: `Committed %`, `Available %`, `Default %`. We collapsed it into a single **Capacity** cell that reads "X% committed of Y%" with the X going amber on over-commit. Reasoning:

- The three numbers are mutually contextual — read in isolation they're harder to interpret. "75% committed" is ambiguous until you know it's 75 of 80, not 75 of 100.
- Table width on the page is limited; three numeric columns plus the rest pushes the layout to horizontal scroll.
- The expander view shows the per-project breakdown, so the table-level number is a summary, not the full picture.

Default capacity is shown as the denominator (e.g., "70% of 80%") so part-time staff aren't misread as under-loaded.

### D6 — No team / squad / pod grouping in this change

PortX doesn't model teams in Torii today. Project membership flows through the PM/SA/SC role FKs and through allocations. Adding a `Team` entity to power "group rows by team" would be a significant schema change without a clear payoff at our scale — sorting + a sortable role column gets you 80% of the same affordance. Defer.

### D7 — No filtering UI in v1

At ~64 rows, sort + browser find covers every realistic filter (find Aaron, list all PMs, find anyone over-committed). Adding filter chips for role / Harvest-linked / over-committed would be useful at 200+ rows but at our current scale would add UI surface without commensurate value.

### D8 — Over-commit chip uses the same rule as the detail page

`committed + availability > defaultCapacityPct` is the over-committed signal on `/people/:id`. We reuse that exact rule for the index's amber chip so the two surfaces never disagree. The chip color matches the existing advisory line styling (`text-status-warning` / amber background) to avoid introducing a new color semantics.
