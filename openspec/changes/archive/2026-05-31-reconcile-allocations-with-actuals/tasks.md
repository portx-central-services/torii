## 1. Shared math + types

- [x] 1.1 Add `plannedHoursForAllocation({ pct, defaultCapacityPct, startISO, endISO })` helper in `packages/shared/src/capacity.ts` (new file): `(pct/100) × (defaultCapacityPct/100) × 40 × weeksBetween(start, end)`. Allow fractional weeks; floor never.
- [x] 1.2 Add `varianceBucket(plannedHours, actualHours): 'green' | 'amber' | 'red' | 'neutral'` helper with thresholds 10% / 25%; returns `'neutral'` when planned is 0 or actuals are null
- [x] 1.3 Add `PersonReconciliationRowSchema` (Zod) for the per-person reconciliation row: `{ projectId, projectName, plannedHours, actualHours: number | null, variance: number | null, variancePct: number | null, linkedToHarvest: boolean }`
- [x] 1.4 Vitest: `capacity.test.ts` — planned-hours math (whole + partial weeks; varied defaultCapacityPct); variance buckets at each threshold; null actuals → 'neutral'

## 2. Harvest user listing + linking endpoints

- [x] 2.1 Extend `HarvestAdapter` with `listUsers(): Promise<Array<{ id: string; name: string; email: string }>>` calling `GET /v2/users?is_active=true&per_page=100` with paging
- [x] 2.2 Add `GET /api/tracker/harvest/users` (Admin only) returning `Array<{ harvestUserId, name, email, linkedToiriPersonId, linkedToiriPersonName }>` joined against `Person.harvest_user_id`
- [x] 2.3 Add `POST /api/people/:id/harvest-link` (Admin only) — body `{ harvestUserId: string }`; rejects when the Harvest user is unknown to Harvest OR already linked to another Torii Person
- [x] 2.4 Add `DELETE /api/people/:id/harvest-link` (Admin only) — clears `Person.harvest_user_id`
- [x] 2.5 Vitest: list returns paged data; link rejects when Harvest user is already linked elsewhere; link rejects when Harvest user is unknown; unlink clears the FK

## 3. Per-person reconciliation endpoint

- [x] 3.1 Add `GET /api/people/:id/reconciliation` (any authenticated user) — for the given Person, query their `allocations` joined with `Project` joined with `project_harvest_snapshots`; group by project; compute planned (from allocations) + actual (sum from breakdown where person.personId === Person.harvest_user_id) per project
- [x] 3.2 Return `Array<PersonReconciliationRow>`, sorted by project name
- [x] 3.3 When `Person.harvest_user_id` is null, every row's `actualHours`/`variance`/`variancePct` is null and `linkedToHarvest = false`
- [x] 3.4 Vitest: happy-path matches expected math; no-Harvest-link returns null actuals; person with no allocations returns empty array

## 4. Web API client

- [x] 4.1 Add `listHarvestUsers()`, `linkPersonToHarvestUser(personId, harvestUserId)`, `unlinkPersonHarvestUser(personId)`, `personReconciliation(personId)` to `apps/web/src/api/endpoints.ts`
- [x] 4.2 Add `HarvestUserListItem` and `PersonReconciliationRow` interfaces to the same file

## 5. /trackers Harvest-user link table

- [x] 5.1 Add `<HarvestUserLinkTable>` component to `apps/web/src/routes/trackers.tsx`, rendered below the existing `<HarvestLinkTable>` when a Harvest connection is healthy
- [x] 5.2 Fetch `endpoints.listHarvestUsers()` + `endpoints.listPeople()`; for each Harvest user, render a row with name + email + a `<select>` of Torii Persons (or "Skip" / "Already linked to <name>")
- [x] 5.3 onChange handler calls `linkPersonToHarvestUser`; refresh both queries on success
- [x] 5.4 Surface 429s as the same toast the project-link table uses

## 6. Per-project reconciliation panel

- [x] 6.1 Add `apps/web/src/components/ReconciliationPanel.tsx`. Props: `{ projectId }`. Internally fetches both project allocations (already done by AllocationsPanel — share the query key) and the Harvest snapshot (already done by HarvestPanel — share that query key too). No new endpoint.
- [x] 6.2 Build a per-person row map: walk allocations, group by personId, compute total planned hours via the shared `plannedHoursForAllocation` helper
- [x] 6.3 Resolve each allocated Person's Harvest hours: `Person.harvest_user_id` → look up in snapshot breakdown; sum across all tasks where `person.personId === harvest_user_id`
- [x] 6.4 Render a table: Person name | Planned hours | Actual hours | Variance (hours + %) | Status chip
- [x] 6.5 Below the main table, a collapsed `<details>` "Logged but not allocated" listing every person in the Harvest breakdown whose `harvest_user_id` doesn't match any allocated Person on this project; show name + actual hours
- [x] 6.6 Empty states: "No allocations on this project" (no allocations); "No Harvest snapshot" (no snapshot); "No people on Harvest are linked to Torii yet" (allocations exist but no `Person.harvest_user_id` for any of them — links to /trackers admin)
- [x] 6.7 Wire `<ReconciliationPanel>` into `project-detail.tsx` below the AllocationsPanel

## 7. Per-person reconciliation section on /people/:id

- [x] 7.1 Add a new "Allocations vs. Actuals" section at the bottom of `person-detail.tsx`
- [x] 7.2 Fetch `endpoints.personReconciliation(id)`; render a table: Project name (link) | Planned | Actual | Variance | Status chip
- [x] 7.3 Empty / no-link / no-allocations states mirror the per-project panel
- [x] 7.4 Section is hidden entirely when the Person has no allocations AND no Harvest user link (nothing meaningful to show)

## 8. CSS for the status chip

- [x] 8.1 Add `.variance-chip-green` / `.variance-chip-amber` / `.variance-chip-red` / `.variance-chip-neutral` classes to `app.css` matching the existing badge pattern (small rounded pills, single-line)

## 9. Spec deltas

- [x] 9.1 `capacity-planning` — reconciliation math + the per-person reconciliation endpoint requirement
- [x] 9.2 `harvest-integration` — Harvest user listing + Person-link endpoints + /trackers user-link table requirement
- [x] 9.3 `dashboard-views` — per-project ReconciliationPanel requirement + per-person "Allocations vs. Actuals" section requirement

## 10. Verification

- [x] 10.1 `pnpm --filter @torii/api test` green
- [x] 10.2 `pnpm --filter @torii/web exec tsc --noEmit` clean
- [x] 10.3 `pnpm --filter @torii/web build` succeeds
- [x] 10.4 Manually: as admin, open `/trackers` → "Link Harvest users" — link 3 Torii People to their Harvest counterparts; refresh; confirm `Person.harvest_user_id` is set in the DB
- [x] 10.5 Manually: open a project detail page where allocations exist and at least one allocated Person is Harvest-linked — confirm the ReconciliationPanel renders planned vs. actual hours, with the correct variance chip
- [x] 10.6 Manually: a person who is in the Harvest breakdown but NOT allocated in Torii appears in the "Logged but not allocated" disclosure
- [x] 10.7 Manually: open `/people/:id` for a linked Person — confirm the "Allocations vs. Actuals" section lists their projects with correct totals
- [x] 10.8 Manually: open `/people/:id` for an unlinked Person (no `harvest_user_id`) — confirm rows show "no Harvest link" instead of variance chips
