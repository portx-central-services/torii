## Why

Several rough edges across the app surfaced during use: the right-side label for the third project role still reads "Solution Consultant" even though Monday's column is "Senior Consultant" and the role's intended meaning matches Monday; navigation order doesn't match how the pages are used (Timeline and Risks are checked daily, Trackers monthly); the nav doesn't pin to the viewport so long pages bury both the logo and the signed-in user; the Projects page lacks a free-text filter and its KPI tiles are decorative rather than functional; the Risks page shows only the current week with no week-over-week context per project; the Trackers Harvest link table is unsorted; and the "Add the first" risk-update button silently no-opped on projects without prior history (fixed in code already, captured here for completeness).

This change bundles those into one UX polish pass — no schema work, no API contract changes, no env changes.

## What Changes

### Fix: "Add the first" risk-update button on the project detail page

- *(Already applied in code; captured here so the change record is complete.)*
- `RiskProjectCard` checked `!current` before `editing && isPM` in its render branches. Clicking "Add the first" set state, but the re-render fell back into the empty-state branch instead of opening the form. Swapped to check `editing && isPM` first; `RiskEditForm` already accepts `initial: undefined` with sensible defaults.

### Rename: "Solution Consultant" → "Senior Consultant" (display only)

- The detail-field storage key remains `solution_consultant` — renaming the JSON key would force a data migration touching every project row's `details` JSONB and every stored `field_mapping` snapshot. Only user-visible strings change.
- Monday's title-map already maps the column `"Senior Consultant" → solution_consultant`. This change brings Torii's display labels in line with the source of truth.

### Navigation

- Reorder nav links: **Timeline → Risks → Projects → Capacity → Trackers**.
- Make the header (logo + nav links) **sticky to the top of the viewport**.
- Make the signed-in user footer **sticky to the bottom of the viewport**.
- The main content scroll region sits between the two sticky bands.

### Projects page

- Add a **search input** to the page that filters the list client-side across project properties: name, owner, PM / SA / SC names, current state, current phase label, core solution, core vendor, customer type, customer status, finance use case, use-case group, primary contact. Case-insensitive substring; the filtered count updates live.
- Make the **KPI tiles at the top into filter links**: clicking "Active" / "On track" / "At Risk" / "Blocked" / "Go-Live ≤ 60d" toggles a single-selected tile filter that narrows the list. Re-clicking the active tile clears it. Filters compose with the search input and the existing filter dropdowns via AND.
  - **Active** = state in (OnTrack, AtRisk, Blocked) AND phase ≠ Backlog (i.e., not Done and not still in backlog).
  - **On track** = state = OnTrack.
  - **At Risk** = state = AtRisk.
  - **Blocked** = state = Blocked.
  - **Go-Live ≤ 60d** = `target_go_live` is set AND within 60 days from today AND state ≠ Done.

### Risks page

- Below each project's current-week card, render a one-line subtext summarizing the previous week: "Last week: `<RAG>` / `<state>`" — or "Last week: no update" when no prior week exists. Complements the existing ▲/▼/= arrow next to the current RAG chip.

### Trackers page

- Sort the Harvest "Link Harvest projects" table alphabetically by Harvest project name. Currently the rows render in whatever order the Harvest API returns them.

## Capabilities

### Modified Capabilities

- `dashboard-views` — navigation reorder + sticky bands; Projects-page search + tile-as-filter.
- `project-lifecycle` — `solution_consultant` storage key keeps its name; display label becomes "Senior Consultant".
- `risk-tracking` — adds the per-project entry path on the detail page (`RiskProjectCard` embedded with `linkToProject={false}`); adds previous-week subtext on the Risks page.
- `tracker-import` — Harvest link-table rows sorted alphabetically.

## Impact

- **New code**: small JSX additions across NavShell, projects-list, risks, trackers; CSS for sticky bands.
- **No DB migrations.**
- **No API changes** (Projects search + tile filters are client-side; previous-week data is already returned by `getProjectRiskUpdates`).
- **No env changes.**

## Non-goals

- No renaming the `solution_consultant` JSON storage key (display-only rename).
- No multi-select tile filters (the existing dropdowns handle multi-select; the tiles are one-click toggles).
- No URL-state persistence for search / tile filter (a future change can add `?q=…&tile=…`).
- No two-way binding between the Projects search input and the existing filter dropdowns (search composes as an additional AND clause).
- No aggregate "last week vs this week" KPI strip on the Risks page (the previous-week info is per-card; the existing top-strip KPIs stay current-week-only).
