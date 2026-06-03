## 1. Prisma schema + migration

- [x] 1.1 Add `PersonProjectCapacity` model to `apps/api/prisma/schema.prisma`: `personId String @map("person_id")`, `projectId String @map("project_id")`, `weeklyPct Int @map("weekly_pct")` (0–100), `createdAt`, `updatedAt`. Composite primary key `@@id([personId, projectId])`. Relations: `person Person @relation(...)`, `project Project @relation(...)`, both with `onDelete: Cascade`. `@@map("person_project_capacities")`.
- [x] 1.2 Add `availabilityPct Int @default(0) @map("availability_pct")` to the `Person` model.
- [x] 1.3 Add the back-relation `personProjectCapacities PersonProjectCapacity[]` to both `Person` and `Project` models.
- [x] 1.4 Run `pnpm --filter @torii/api exec prisma migrate dev --name add_person_self_reported_capacity` and review the generated SQL. Single mechanical migration; no inline backfill needed (`availability_pct` defaults to 0, the new table is empty).
- [x] 1.5 `pnpm --filter @torii/api exec prisma generate` to refresh the TS client.

## 2. API: workload endpoint

- [x] 2.1 New module `apps/api/src/routes/workload.ts` exporting `registerWorkloadRoutes({ db })`.
- [x] 2.2 `GET /api/people/:id/workload` — any authenticated user. Response shape:
  - `availabilityPct: number`
  - `defaultCapacityPct: number`
  - `lastReportedAt: string | null` (most recent `updated_at` across the person's `person_project_capacities`; null when no rows)
  - `projects: Array<{ projectId, projectName, projectPhase, projectState, weeklyPct, allocatedPct, lifetimeHours, varianceBucket: 'green' | 'amber' | 'red' | 'neutral' }>`
  - `projects` includes every project in the union: (active allocation, i.e. `today BETWEEN start AND end`) ∪ (non-zero `person_project_capacities.weekly_pct`).
  - `weeklyPct` is the self-reported value, or 0 when no row exists for that project.
  - `allocatedPct` is the sum of `Allocation.pct` for *active* allocations only (overlapping `today`).
  - `lifetimeHours` and `varianceBucket` reuse the existing reconciliation math (sum across pinned `harvest_projects` breakdown rows for this person's `harvest_user_id`, plus `varianceBucket` from the shared helper). Both null/neutral when the person isn't Harvest-linked.
- [x] 2.3 `PATCH /api/people/:id/workload` — body `{ availabilityPct?: number, projects?: Array<{ projectId: string, weeklyPct: number }> }`. Auth: `viewer.id === person.id || viewer.isAdmin` (else 403). Validate each `weeklyPct` and `availabilityPct` is `0 ≤ n ≤ 100`. Upserts each `projects[]` row in a single transaction; when `weeklyPct === 0`, DELETE the row instead of upserting. Returns the refreshed workload response (same shape as GET).
- [x] 2.4 Register the module in `apps/api/src/app.ts`.

## 3. Shared schema

- [x] 3.1 Add `WorkloadRowSchema` and `WorkloadResponseSchema` to `packages/shared/src/schemas.ts` mirroring the response. Export `WorkloadRow` and `WorkloadResponse` types.
- [x] 3.2 Add `WorkloadUpdateSchema` for the PATCH body.

## 4. Web API client

- [x] 4.1 Add `getPersonWorkload(id)` and `updatePersonWorkload(id, body)` helpers to `apps/web/src/api/endpoints.ts` with the new types.

## 5. Web: Workload section on `/people/:id`

- [x] 5.1 New component `apps/web/src/components/WorkloadSection.tsx` rendered on `/people/:id` between the existing role sections and the reconciliation section. Props: `personId: string`, `editable: boolean` (computed by the parent).
- [x] 5.2 The parent (`apps/web/src/routes/person-detail.tsx`) computes `editable = currentUser.id === personId || currentUser.isAdmin` and passes it down. Pulls `useAuth()` for the viewer identity.
- [x] 5.3 Top of the section: a row with the **Availability for more work** label and either an inline numeric input (0–100, step 5) when `editable`, or a static `N%` display otherwise. When editable, debounce the save (300ms) and show a small "saved" pulse on success.
- [x] 5.4 Body of the section: a table of workload rows. Columns: project name (link to `/projects/:id`), phase badge, current weekly capacity (inline % editor when editable, static display otherwise), allocated % (read-only; muted gray text — "Planned: N%"), lifetime hours, variance chip (reuse `.variance-chip-*` classes).
- [x] 5.5 When `editable`, each row has a "Remove" button that PATCHes with `weeklyPct: 0` for that project (which the API translates to DELETE).
- [x] 5.6 When `editable`, an "Add project" button at the bottom of the table opens a small dropdown of projects NOT already in the workload list (excluding Done projects). Selecting a project PATCHes with `{ projects: [{ projectId, weeklyPct: 0 }] }` — wait, that would delete it. Use a small modal or a default starting `weeklyPct: 5` so the row is created. Choose the default-5 approach for fewer clicks.
- [x] 5.7 Below the table, an advisory line: `Σ reported: X% · availability: Y% · unaccounted: Z%`. `Z = max(0, defaultCapacityPct - X - Y)`. When `X + Y > defaultCapacityPct`, the line goes amber and reads `over-committed by N%` instead of `unaccounted`. Use `text-status-warning` for the amber state.
- [x] 5.8 Empty state: when the response has zero projects, render a single line — "No projects reported. " followed by either an "Add project" affordance (editable) or a muted "Nothing to show yet" (read-only).
- [x] 5.9 Loading + error states: skeleton placeholder while loading; muted error message in red if the fetch fails.

## 6. Web: cache + invalidation

- [x] 6.1 `useQuery(['workload', personId], ...)` for the GET. Stale time: 0 (always refetch on focus, since the data is user-editable).
- [x] 6.2 On successful PATCH, invalidate `['workload', personId]` AND `['capacity-rollup']` (the team-capacity view reads from a different aggregation but seeing fresh data is helpful) AND `['person-reconciliation', personId]` (the existing card on the same page).

## 7. CSS

- [x] 7.1 Reuse `.kpi`, `.variance-chip-*`, `.input` classes. Add small `.workload-section`, `.workload-row`, `.workload-advisory`, `.workload-advisory-warn` styles for the inline-editor row layout (label-on-left, input on the right, with a save-pulse animation on mutation success).
- [x] 7.2 Add `.pct-input` for a narrow numeric input (width: 64px, right-aligned, with a `%` suffix shown via a sibling span).

## 8. Spec deltas

- [x] 8.1 `capacity-planning` — ADD requirements: `PersonProjectCapacity entity`, `Person.availability_pct`, `GET /api/people/:id/workload`, `PATCH /api/people/:id/workload`.
- [x] 8.2 `dashboard-views` — MODIFY `Per-person view at /people/:id` requirement to include the Workload section and the inline-edit behavior under self-or-admin conditions.

## 9. Verification

- [x] 9.1 `pnpm --filter @torii/api test` green. New tests for: workload endpoint shape, 403 on non-self non-admin PATCH, delete-on-zero behavior, advisory sum math.
- [x] 9.2 `pnpm --filter @torii/web exec tsc --noEmit` clean.
- [x] 9.3 `pnpm --filter @torii/web build` succeeds.
- [ ] 9.4 Manually: open own `/people/:id`, set availability to 40%, set weekly capacity on a project, verify the advisory line updates and a refresh of the page persists the values.
- [ ] 9.5 Manually: open another user's `/people/:id` as a non-admin, verify the section renders read-only with no inputs and no Remove/Add buttons.
- [ ] 9.6 Manually: as admin, open another user's `/people/:id`, verify the section renders editable and saves apply correctly.
- [ ] 9.7 Manually: set a `weeklyPct` to 0, verify the row disappears from the table on next refresh (delete-on-zero).
- [ ] 9.8 Manually: a project where the person has an active allocation but no self-report shows up in the table with `Planned: N%` and `weeklyPct = 0%`.
- [ ] 9.9 Manually: a project where the person has a self-report but no formal allocation shows up with `Planned: —` and the self-reported `weeklyPct`.
- [ ] 9.10 Manually: total reported + availability over `defaultCapacityPct` flips the advisory line to amber.
