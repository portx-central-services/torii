## 1. Prisma schema + migration

- [x] 1.1 Add two columns to the `Person` model: `billedHoursLast30d Decimal? @db.Decimal(10, 2) @map("billed_hours_last_30d")` and `billedHoursAsOf DateTime? @map("billed_hours_as_of")`.
- [x] 1.2 Hand-write the migration at `apps/api/prisma/migrations/<ts>_add_person_billed_hours_30d/migration.sql` — `ALTER TABLE "people" ADD COLUMN ...`, both nullable, no backfill needed.
- [x] 1.3 Run `pnpm --filter @torii/api exec prisma migrate deploy` to apply locally, then `prisma generate` to refresh the TS client.

## 2. API: sync engine 30d aggregation

- [x] 2.1 In `apps/api/src/sync/engine.ts`, gather every project's time-entry list during Step 3 (the per-project snapshot loop). The `getProjectSnapshot()` result already returns `raw.timeEntries` — collect them keyed by the harvest project id.
- [x] 2.2 After Step 3 completes, run a single pass over all collected time entries: filter to those with `spent_date >= today − 30d`, bucket by `user.id`, sum `hours`. Update the matching `Person` row's `billedHoursLast30d` + `billedHoursAsOf` via `db.person.update` (one update per matched harvest user id).
- [x] 2.3 For people whose `harvest_user_id` is set but who have ZERO entries in the 30-day window, also set their `billedHoursLast30d` to 0 (with the current `as_of`) — so leavers / inactive staff don't keep stale prior values.
- [x] 2.4 Wrap the aggregation in a try/catch — if the rollup throws, log and continue. Don't fail the whole sync over the new derived field.

## 3. API: people overview endpoint

- [x] 3.1 New file `apps/api/src/routes/people-overview.ts` exporting `registerPeopleOverviewRoutes({ db })`.
- [x] 3.2 `GET /api/people/overview` — any authenticated user. Response: `Array<PeopleOverviewRow>`. For each Person, compute:
  - Basic fields (id, name, email, role, isAdmin, harvestUserId)
  - `defaultCapacityPct`, `availabilityPct` (from the Person row)
  - `committedPct` = sum of `weeklyPct` across this person's `person_project_capacities`
  - `billedHoursLast30d`, `billedHoursAsOf` (from the cached columns)
  - `lastReportedAt` = most recent `updated_at` among this person's capacity rows; null when no rows
  - `currentProjects` = union of (active allocations: today between start and end) and (non-zero `person_project_capacities` rows). Each entry includes `projectId, projectName, projectPhase, weeklyPct, allocatedPct, lifetimeHours, varianceBucket`. Reuse the same union-build logic from `routes/workload.ts` — factor into a small helper if needed.
- [x] 3.3 Register the new route module in `apps/api/src/app.ts`.

## 4. Shared schemas

- [x] 4.1 Add `PeopleOverviewRowSchema` to `packages/shared/src/schemas.ts` mirroring the response shape. Export `PeopleOverviewRow` type.

## 5. Web API client

- [x] 5.1 Add `getPeopleOverview()` helper to `apps/web/src/api/endpoints.ts` returning `PeopleOverviewRow[]`.

## 6. Web: `/people` index page

- [x] 6.1 New file `apps/web/src/routes/people-list.tsx` exporting `<PeopleListPage>`. Use `useQuery(['people-overview'], endpoints.getPeopleOverview)`.
- [x] 6.2 Page header: "People" title with a one-line subtitle ("Roster, workload, and recent billing across the team.").
- [x] 6.3 Sortable table. Columns: Name, Role, Capacity, Available, 30d billed, Active projects (with expand), Last reported.
- [x] 6.4 Name column: link to `/people/:id`. Role column: `PM` or `Viewer` chip + `Admin` star when `isAdmin`. Add a muted "Harvest" badge when `harvestUserId === null` to flag unlinked people.
- [x] 6.5 Capacity cell: render as `N% committed of M%` with `N = committedPct`, `M = defaultCapacityPct`. When `committedPct + availabilityPct > defaultCapacityPct`, the cell carries an amber "Over by X%" chip alongside.
- [x] 6.6 Available cell: `availabilityPct`% — same numeric formatting.
- [x] 6.7 30d billed cell: `N.Nh` formatted hours, or em-dash when `billedHoursLast30d === null`. Tooltip: "Updated <relative-time>" reading from `billedHoursAsOf`.
- [x] 6.8 Active projects cell: count + a chevron (▶/▼) toggle. Default collapsed. Local component state (Set of expanded person ids).
- [x] 6.9 Expanded row content: a small sub-table rendering each `currentProjects[]` entry — project name (link to `/projects/:id`), phase badge, `Current: N%`, `Planned: M%` (muted when zero), lifetime hours, variance chip. Use the existing `.variance-chip-*` classes.
- [x] 6.10 Last reported cell: relative-time format ("3 days ago", "—" when null).
- [x] 6.11 Loading + error states: skeleton row while loading; muted error message on failure.

## 7. Routing + nav

- [x] 7.1 In `App.tsx`, add `<Route path="people" element={<PeopleListPage />} />` between the projects routes and the capacity route.
- [x] 7.2 In `NavShell.tsx`, add a `<NavLink to="/people">People</NavLink>` entry between Projects and Capacity. Update the breadcrumb label switch so `/people` reads "People" (the existing `/people/:id` breadcrumb stays as "Person detail").

## 8. CSS

- [x] 8.1 New `.people-table`, `.people-table-expanded` styles. Sub-table inside expanded row gets a light tinted background to read as a nested view.
- [x] 8.2 New `.people-overcommit-chip` (amber, same palette as `.workload-advisory-warn`).
- [x] 8.3 Chevron icon styling: rotates 90° when row is expanded (CSS transition).

## 9. Spec deltas

- [x] 9.1 `capacity-planning` — ADD requirements: `Person billed_hours_last_30d + billed_hours_as_of` columns, the sync-side 30-day aggregation, and `GET /api/people/overview`.
- [x] 9.2 `dashboard-views` — ADD `People index at /people` requirement (sortable columns, expander behavior, read-only). MODIFY the existing `Navigation shell` requirement to insert `People` between `Projects` and `Capacity`.

## 10. Verification

- [x] 10.1 `pnpm --filter @torii/api test` green. New tests covering: overview endpoint shape, committedPct summing, currentProjects union with both allocation-only + capacity-only entries.
- [x] 10.2 `pnpm --filter @torii/web exec tsc --noEmit` clean.
- [x] 10.3 `pnpm --filter @torii/web build` succeeds.
- [ ] 10.4 Manually: open `/people` — the page lists everyone, columns render plausibly.
- [ ] 10.5 Manually: sort by each column and confirm the ordering.
- [ ] 10.6 Manually: expand a row that has both an active allocation AND a self-report on the same project; confirm both `Current` and `Planned` render side by side.
- [ ] 10.7 Manually: a person with no `harvest_user_id` shows the "Harvest" muted chip and `30d billed = —`.
- [ ] 10.8 Manually: an over-committed person (Σ weeklyPct + availability > defaultCapacityPct) shows the amber "Over by N%" chip in the Capacity cell.
- [ ] 10.9 Manually: trigger a Harvest sync and verify the 30d billed values populate; the "Updated <time>" tooltip on hover shows recent.
- [ ] 10.10 Manually: confirm the nav "People" link sits between Projects and Capacity, and routes to `/people`.
