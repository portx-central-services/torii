## 1. Confirm Monday column title

- [ ] 1.1 Run `pnpm --filter @torii/api exec tsx apps/api/scripts/probe-monday-project.ts <known-fintech-projectId>` against the production tracker. Record the exact title (e.g., `"Fintech Parent"`). Use that string verbatim in step 2.1. If the column doesn't exist on Monday, STOP and escalate to PMO before merging.

## 2. API: Monday adapter

- [x] 2.1 Live data confirmed TWO related columns: `'Fintech Parent'` and `'Fintech'`. Add a small special-case block at the end of `extractDetails` in `apps/api/src/sync/monday/MondayAdapter.ts` that reads both candidates from the item's `column_values` and assigns `details.fintech_parent` with `'Fintech Parent'` taking precedence over `'Fintech'`. Both columns are text (not link), so URL extraction does not apply. Do NOT add these to `MONDAY_COLUMN_TITLE_MAP` (it's 1:1 and would make precedence depend on Monday's response order).
- [x] 2.2 Confirm `URL_DETAIL_KEYS` does NOT include `fintech_parent` (it shouldn't — the columns are text, not links).

## 3. Shared schema

- [x] 3.1 Add `fintech_parent` to `PROJECT_DETAIL_KEYS` in `packages/shared/src/schemas.ts`.
- [x] 3.2 Add `fintech_parent: detailText` to `ProjectDetailsSchema` (keeps `.strict()`).

## 4. Field mapping default

- [x] 4.1 In `apps/api/src/sync/engine.ts` (or wherever the default Monday-owned field-mapping list is constructed), add `'details.fintech_parent'` to the Monday-owned defaults — same list that includes `details.project_manager` etc.

## 5. Tests

- [x] 5.1 Extend `apps/api/test/monday-adapter.test.ts` with a test: an item with a `'Fintech Parent'` column set to `'Acme Holdings'` extracts to `details.fintech_parent = 'Acme Holdings'`.
- [x] 5.2 Test the fallback path: an item with only `'Fintech'` set (no `'Fintech Parent'` or it's empty) and value `'Beta Co'` extracts to `details.fintech_parent = 'Beta Co'`.
- [x] 5.3 Test the precedence: both columns set with different values — `'Fintech Parent'` wins.
- [x] 5.4 Test empty/whitespace on both columns yields `details.fintech_parent` absent.
- [x] 5.5 Add a test (probably in `apps/api/test/projects.test.ts`): a project whose `details.fintech_parent` is set returns `projectType: 'fintech'` from `GET /api/projects/:id`.

## 6. Spec deltas

- [x] 6.1 `tracker-import` — MODIFY the existing "Field mapping" requirement to include `details.fintech_parent` in the Monday-owned defaults list. ADD a scenario covering Fintech Parent extraction.

## 7. Verification

- [x] 7.1 `pnpm --filter @torii/api test` green.
- [x] 7.2 `pnpm --filter @torii/api exec tsc --noEmit` clean.
- [x] 7.3 `pnpm --filter @torii/web exec tsc --noEmit` clean (`ProjectDetails` type change ripples through but is additive).
- [ ] 7.4 Manual: trigger a Monday sync via `POST /api/tracker/monday/sync` (admin) and confirm at least one known-fintech project now reads with `projectType: 'fintech'` via `GET /api/projects/:id`.
- [ ] 7.5 Manual: on the Insights page (`/insights`), confirm the per-project table now reflects fintech projects correctly (this works without code change — the table reads the same projects endpoint).
- [ ] 7.6 Manual: on the Portfolio Dashboard's projectType filter (if surfaced), `fintech` now matches the expected projects.
