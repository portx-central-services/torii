## 1. Shared types & validation

- [x] 1.1 In `packages/shared`, define `PROJECT_DETAIL_KEYS` (the 12 keys) and a `ProjectDetails` type of optional strings
- [x] 1.2 Add a Zod schema validating `details`: only known keys, string values, and URL format for `status_report_url` / `jira_project_url`
- [x] 1.3 Extend `DEFAULT_FIELD_MAPPING`: `details.<key>: 'monday'` for the 11 Monday-sourced keys; `details.primary_contact: 'torii'`
- [x] 1.4 Add `details?: Record<string,string>` to the `ExternalProject` type

## 2. Schema & migration

- [x] 2.1 Add `details Json @default("{}") @map("details")` to the `Project` model in `apps/api/prisma/schema.prisma`
- [x] 2.2 Add a `UserPreference` model: `id`, `personId @unique`, `data Json @default("{}")`, timestamps, relation to `Person`
- [x] 2.3 Create the migration SQL (add `projects.details`, create `user_preferences` table + FK + unique index)
- [x] 2.4 Regenerate the Prisma client

## 3. Monday adapter: extract detail columns

- [x] 3.1 Add a fixed `MONDAY_COLUMN_TITLE_MAP` in `MondayAdapter.ts` per the final map (Project Manager, Solution Architect, Senior Consultant→solution_consultant, Core Solution, Core→core_vendor, Status Report, Jira, Customer Type, Finance - Use Case, Use Case - Group, Customer Status)
- [x] 3.2 In `toExternalProject`, populate `details` from `column_values` by title match; omit empty values; for `status_report_url`/`jira_project_url` extract the first `https?://` token from the text
- [x] 3.3 Log expected-but-unmatched column titles at info level to aid debugging title drift
- [x] 3.4 Unit-test extraction: recognized column maps, unrecognized ignored, empty yields no key, link column yields extracted URL
- [x] 3.5 Request `display_value` (MirrorValue/BoardRelationValue) and pin `API-Version`; resolve `display_value ?? text`
- [x] 3.6 Define a single shared `COLUMN_VALUES_SELECTION` reused by both `LIST_BOARDS_QUERY` and `GET_ITEM_QUERY` so the two cannot drift; regression-test per-item query parity (display_value)

## 4. Merge engine: details ownership

- [x] 4.1 In `merge-fields.ts`, extend the patch to walk each `details.<key>`: apply external value only when owner != 'torii' and value differs
- [x] 4.2 Ensure the merged `details` is a shallow merge over existing `details` (don't drop torii-owned keys)
- [x] 4.3 In `engine.ts` sync paths, include `details` in the `db.project.update` payload when the patch changed it
- [x] 4.4 Unit-test: monday-owned detail updates; torii-owned detail preserved; empty external leaves existing intact

## 5. Projects API

- [x] 5.1 Add `details` to `serializeProject` (both list and detail responses)
- [x] 5.2 Accept and validate `details` in `POST /api/projects` and `PATCH /api/projects/:id` via the shared schema
- [x] 5.3 On PATCH, shallow-merge incoming `details` over existing and re-validate
- [x] 5.4 Route tests: persist/return details; reject unknown key; reject malformed URL

## 6. Preferences capability (API)

- [x] 6.1 Add `apps/api/src/routes/preferences.ts` with `GET /api/me/preferences` and `PUT /api/me/preferences`
- [x] 6.2 GET returns `{ hiddenProjectColumns: [] }` when no row exists; PUT upserts by `personId`
- [x] 6.3 Validate `hiddenProjectColumns` against the known project-list column id set; 400 on unknown
- [x] 6.4 Require auth on both; scope strictly to the caller; register the route in the app
- [x] 6.5 Route tests: default empty, upsert+read, unknown column rejected, 401 unauthenticated

## 7. Web: API client & types

- [x] 7.1 Extend `Project`/`ProjectDetail` types in `endpoints.ts` with `details`
- [x] 7.2 Add `getPreferences()` and `updatePreferences(hiddenProjectColumns)` endpoint helpers + types

## 8. Web: project list page

- [x] 8.1 Add the 12 detail columns to the table (labels incl. "Core Vendor" for `core_vendor`); render `status_report_url` / `jira_project_url` as anchors (`rel="noreferrer"`); default-visible = project_manager, solution_architect, core_solution, core_vendor
- [x] 8.2 Load preferences on mount (react-query) and hide columns in `hiddenProjectColumns`
- [x] 8.3 Add a column show/hide control; toggling writes via `updatePreferences` (optimistic) and invalidates the prefs query
- [x] 8.4 Implement client-side sort on every column incl. details; empty values sort last; toggle asc/desc on header click
- [x] 8.5 Apply horizontal scroll / sensible default-hidden columns so the wide table stays usable

## 9. Web: project detail page

- [x] 9.1 Render all 11 detail fields in a "Project details" panel; link fields as anchors when set
- [x] 9.2 Add a PM-only editor for `torii`-owned detail fields that PATCHes `details`
- [x] 9.3 Invalidate the project query after save so the panel refreshes

## 10. Verification

- [x] 10.1 `pnpm --filter @torii/api test` green
- [x] 10.2 `pnpm --filter @torii/web exec tsc --noEmit` clean
- [x] 10.3 Apply migration in dev DB; verify `projects.details` and `user_preferences` exist
- [x] 10.4 In the running app: Sync Now, confirm detail fields populate from Monday on the list + detail pages
- [ ] 10.5 Hide a column, reload (and on another browser/profile) — confirm it stays hidden per user
- [ ] 10.6 Click a details column header — confirm client-side sort with empties last
- [ ] 10.7 As PM, flip a detail field to torii-owned, edit it, run sync — confirm the manual value survives
