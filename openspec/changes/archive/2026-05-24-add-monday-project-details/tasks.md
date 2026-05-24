## 1. Schema and migration

- [x] 1.1 Add `trackerRaw Json? @map("tracker_raw")` to the `Project` model in `apps/api/prisma/schema.prisma`
- [x] 1.2 Create migration `prisma/migrations/<timestamp>_add_project_tracker_raw/migration.sql` containing `ALTER TABLE "projects" ADD COLUMN "tracker_raw" JSONB;`
- [x] 1.3 Regenerate the Prisma client via `pnpm --filter @torii/api prisma:generate`

## 2. Sync engine: persist snapshot on every fetch

- [x] 2.1 In `apps/api/src/sync/engine.ts`, update the bulk `syncConnection` loop to write `trackerRaw: external.raw` on every iteration; bump `projectsPatched` only when `mergeExternalIntoTorii` returns a non-empty patch
- [x] 2.2 Apply the same write semantics to `forceRefreshLinked` (per-item path)
- [x] 2.3 Apply the same write semantics to `syncProject` (single-project refresh); return `patched: 1` only when the merge actually changed name or keyDates
- [x] 2.4 Use `Prisma.JsonNull` when `external.raw` is absent so the field round-trips as JSON null rather than omitting the column

## 3. Import handler: persist snapshot on create and overwrite

- [x] 3.1 In `apps/api/src/routes/tracker.ts`, store `trackerRaw` on `db.project.create` when an import succeeds against a fresh item
- [x] 3.2 Store `trackerRaw` on `db.project.update` when the import is in overwrite mode and the item already exists
- [x] 3.3 When the adapter call for an `externalId` fails, write a placeholder name as before and leave `trackerRaw` set to `Prisma.JsonNull`

## 4. API surface

- [x] 4.1 In `apps/api/src/routes/projects.ts`, extend the `GET /api/projects/:id` response with `trackerRaw: project.trackerRaw ?? null`
- [x] 4.2 Confirm `GET /api/projects` (list) does NOT include `trackerRaw` — keep `serializeProject` unchanged

## 5. Frontend types

- [x] 5.1 In `apps/web/src/api/endpoints.ts`, add a `MondayItemSnapshot` type covering `{ id?, name?, column_values?: [{ id, type?, text?, value?, column?: { id?, title? } }] }`
- [x] 5.2 Extend `ProjectDetail` with `trackerRaw: MondayItemSnapshot | null`

## 6. Project detail page: Monday details panel

- [x] 6.1 In `apps/web/src/routes/project-detail.tsx`, import `MondayItemSnapshot`
- [x] 6.2 Add a `MondayDetailsPanel` component rendered below allocations when `project.trackerRef` exists
- [x] 6.3 In the panel, show the Monday item id and row title in a `detail-side-list`
- [x] 6.4 Filter `column_values` to those with non-empty `text`; render a `tbl`-styled table with columns (Column title or id, Value, Type)
- [x] 6.5 Add a Show/Hide raw JSON toggle that renders the payload via `JSON.stringify(..., null, 2)` inside a scrollable `<pre>`
- [x] 6.6 Handle the no-snapshot case: when `project.trackerRaw` is null, show a message prompting the user to sync from the tracker

## 7. Tests

- [x] 7.1 Update `apps/api/test/sync-engine.test.ts` "preserves Torii-owned" assertion: assert `db.project.update` IS called once, with `trackerRaw` present but `name` and `keyDates` absent
- [x] 7.2 Add a vitest case for the bulk `syncConnection` path that asserts `trackerRaw` is written even when the merge patch is empty
- [x] 7.3 Add a vitest case for `forceRefreshLinked` that asserts per-item errors are logged-and-skipped while other items still get their `trackerRaw` updated
- [x] 7.4 Add a vitest case for `GET /api/projects/:id` that asserts `trackerRaw` is included on the detail response and absent on the list response

## 8. Verification

- [x] 8.1 Run `pnpm --filter @torii/api test` and confirm 0 failures
- [x] 8.2 Run `pnpm --filter @torii/web exec tsc --noEmit` and confirm 0 errors in changed files
- [x] 8.3 Apply the migration in a dev database (`pnpm --filter @torii/api prisma:migrate:dev`) and verify the column exists with `\d+ projects`
- [x] 8.4 In a running dev environment, click Sync Now on the trackers page, open a linked project, and verify the Monday details panel renders identity, the column table, and the raw JSON toggle
- [x] 8.5 Verify a project without `trackerRef` does NOT show the panel
