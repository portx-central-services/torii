## 0. Already applied in code (captured for record)

- [x] 0.1 Fix "Add the first" render-branch order in `RiskProjectCard` — check `editing && isPM` before `!current` so the form opens when there's no prior history
- [x] 0.2 Embed `RiskProjectCard` on the project detail page below the AllocationsPanel, with `linkToProject={false}` and heading "Weekly risk update"
- [x] 0.3 Export `RiskProjectCard` from `routes/risks.tsx` and add the optional `linkToProject` prop (default true)

## 1. Senior Consultant rename (display only)

- [x] 1.1 Grep `"Solution Consultant"` and `solution_consultant` across the codebase; distinguish display strings (rename) from storage keys (keep). Confirm the Monday title-map already maps `"Senior Consultant" → solution_consultant` (no change needed there).
- [x] 1.2 Update `PROJECT_DETAIL_FIELDS` in `apps/web/src/api/endpoints.ts` so the `solution_consultant` entry's display title reads "Senior Consultant"
- [x] 1.3 Update any hard-coded "Solution Consultant" strings in components (project detail row labels, projects list column header, AllocationsPanel team-field labels)
- [x] 1.4 Confirm the `ROLE_LABELS.solution_consultant = 'SC'` mapping in `routes/timeline.tsx` doesn't need to change (it's already an abbreviation)
- [x] 1.5 No DB migration; no Monday-side change

## 2. Navigation

- [x] 2.1 Reorder `<NavLink>` entries in `apps/web/src/components/NavShell.tsx`: Timeline → Risks → Projects → Capacity → Trackers (admin sees Trackers; non-admin doesn't)
- [x] 2.2 Make the header band (logo + nav links) `position: sticky; top: 0` with appropriate `z-index` and `background` so content doesn't bleed through during scroll
- [x] 2.3 Make the signed-in user footer `position: sticky; bottom: 0` with matching `z-index` + `background`
- [x] 2.4 Verify on a long page (e.g., the 200-project /projects list) that both bands stay pinned during scroll and don't visually overlap rows

## 3. Projects page

- [x] 3.1 Add a search `<input>` to the page header (or filter row) with `placeholder="Search projects, people, cores…"` and an `onChange` that updates a `search` filter state
- [x] 3.2 Client-side substring filter (case-insensitive) against: `name`, `details.project_manager`, `details.solution_architect`, `details.solution_consultant`, `details.core_solution`, `details.core_vendor`, `details.customer_type`, `details.customer_status`, `details.finance_use_case`, `details.use_case_group`, `details.primary_contact`, `state`, and the rendered `phaseLabel(phase)` — joined into a haystack string per project
- [x] 3.3 Convert each KPI tile (`Active`, `On track`, `At Risk`, `Blocked`, `Go-Live ≤ 60d`, `Total`) into a `<button>` that toggles a single-selected `tileFilter` state
- [x] 3.4 Define each tile's predicate:
  - `Active`: state in (OnTrack, AtRisk, Blocked) AND phase ≠ Backlog
  - `On track`: state === OnTrack
  - `At Risk`: state === AtRisk
  - `Blocked`: state === Blocked
  - `Go-Live ≤ 60d`: `target_go_live` set AND within 60 days of today AND state ≠ Done
  - `Total`: clears the filter
- [x] 3.5 Clicking the currently active tile a second time clears the filter
- [x] 3.6 Mark the active tile visually (CSS class `kpi-active` with a border accent or background tint)
- [x] 3.7 Compose: tile filter → existing dropdown filters → search, applied in that order via AND

## 4. Risks page

- [x] 4.1 In `<CurrentRiskCard>` (or wherever the per-project card body renders), add a one-line subtext using `previous` (already passed in as `previousLevel`) plus the previous update's `state`. Read both from `updates[1]` rather than just the level.
- [x] 4.2 Render: `Last week: <RAG> / <state>` when `updates[1]` exists; `Last week: no update` when `updates.length === 1`
- [x] 4.3 Style as muted subtext (smaller font + secondary color)

## 5. Trackers page

- [x] 5.1 In `<HarvestLinkTable>` sort the fetched `harvestProjects` array alphabetically by name via `[...harvestProjects].sort((a, b) => a.name.localeCompare(b.name))` before rendering rows

## 6. Spec deltas

- [x] 6.1 `dashboard-views` — adds navigation reorder + sticky bands; adds Projects search; adds Projects tile-as-filter
- [x] 6.2 `project-lifecycle` — Senior Consultant display label (storage key unchanged); explicit "rename is display-only" requirement
- [x] 6.3 `risk-tracking` — `RiskProjectCard` rendered on project detail with `linkToProject={false}`; previous-week subtext requirement
- [x] 6.4 `tracker-import` — Harvest link table sorted alphabetically by name

## 7. Verification

- [x] 7.1 `pnpm --filter @torii/web exec tsc --noEmit` clean
- [x] 7.2 `pnpm --filter @torii/web build` succeeds
- [x] 7.3 `pnpm --filter @torii/api test` green (no API contract changes; sanity-check that nothing regressed)
- [x] 7.4 Manually: confirm "Senior Consultant" label everywhere; no remaining "Solution Consultant" in the UI
- [x] 7.5 Manually: nav header stays visible while scrolling; user footer stays visible
- [x] 7.6 Manually: Projects search filters correctly against multiple property types (name, person, core)
- [x] 7.7 Manually: each KPI tile filters the list; clicking the active tile clears it; combinations with search and existing dropdowns work as expected
- [x] 7.8 Manually: Risks page shows last-week subtext where applicable; "no update" line renders for projects with only one update
- [x] 7.9 Manually: Trackers page shows Harvest projects alphabetically
