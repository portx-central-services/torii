## Why

Every project in Torii currently reads as `projectType: 'direct'` even when it's a fintech engagement. The derivation in `deriveProjectType` is correct — it returns `'fintech'` when `details.fintech_parent` is set — but `fintech_parent` is never populated:

1. The Monday sync (`MondayAdapter.extractDetails`) does not extract a Fintech Parent column.
2. `ProjectDetailsSchema` is `.strict()` and does not allow `fintech_parent` as a key — a PATCH carrying it would 400.
3. `PROJECT_DETAIL_KEYS` does not include `fintech_parent`.

Net effect: the Insights page's "project type" filter, the dashboard's fintech-vs-direct split (`dashboard-views` spec §projectType filter), and the projectType field on every project read response are all silently degraded.

This change lights up the field by sync — when the linked Monday item has a "Fintech Parent" column with a value, the Torii project ends up with `details.fintech_parent` set and reads as `projectType: 'fintech'`. No PM action required; no schema migration.

## What Changes

### Monday adapter — extract the Fintech Parent column

Add the column-title-to-detail-key mapping `'Fintech Parent' → 'fintech_parent'` to `MONDAY_COLUMN_TITLE_MAP` in `apps/api/src/sync/monday/MondayAdapter.ts`. The exact column title MUST be confirmed against the live Monday board (see Design D1) before merging — `apps/api/scripts/probe-monday-project.ts` dumps a project's live column titles.

The extracted value flows through the existing `extractDetails` path: trimmed text (or `display_value` if the column is a mirror), empty values omitted, no URL-extraction needed (it's not a link column).

### Shared schema — accept `fintech_parent`

- Add `fintech_parent: detailText.optional()` to `ProjectDetailsSchema` in `packages/shared/src/schemas.ts`. Keeps the `.strict()` guarantee but allows the new key.
- Add `'fintech_parent'` to the `PROJECT_DETAIL_KEYS` const array (between `core_vendor` and the rest of the Customer-group keys is a sensible spot — keeps the array ordered by display group).

### Field mapping — Monday owns `details.fintech_parent` by default

Extend the default `field_mapping` to include `details.fintech_parent → monday`. This is consistent with every other Monday-sourced details field; PMs can override per-project via the existing field-mapping UI if a value ever needs to be torii-owned. No data migration: existing rows have no field-mapping entry for `fintech_parent`, and the merge engine treats missing entries as Monday-owned for Monday-sourced keys (verify in design).

### No UI changes in v1

`projectType` is already rendered everywhere it matters (Insights table, dashboard projectType filter, project list/detail). Once the value is populated, those surfaces automatically reflect the right type. We do NOT add an editable "Fintech Parent" form field to the project-detail page in v1 — Monday is the authoritative source. If a PM needs to override, the existing field-mapping override pathway already covers it.

### Out of scope

- **Backfill of existing projects**. The next scheduled sync (or any manual sync) picks up the column for already-linked Monday items. No batch update needed.
- **Editable Fintech Parent on the project detail page**. Deferred; can be added by future work if PMs want to set it Torii-side.
- **The Monday column title itself**. We assume `'Fintech Parent'` and verify against live data before merging. If the title is different (e.g., "Fintech Sponsor"), the mapping is a one-character edit.

## Capabilities

### Modified Capabilities

- `tracker-import` — extend the default Monday-owned `field_mapping` list to include `details.fintech_parent`; add a scenario covering its extraction.

## Impact

- **New code**: one entry in `MONDAY_COLUMN_TITLE_MAP`, one field on `ProjectDetailsSchema`, one entry in `PROJECT_DETAIL_KEYS`, one entry in the default field-mapping list.
- **DB**: no schema changes. The `Project.details` column is already JSONB and accepts arbitrary keys at the DB layer; the change is purely about which keys the API validates and which the sync writes.
- **API contracts**: `GET /api/projects` and `GET /api/projects/:id` start returning `projectType: 'fintech'` for projects whose linked Monday item has a Fintech Parent value. `PATCH /api/projects/:id` accepts `details.fintech_parent`.
- **Sync**: every Monday sync pass after merge populates the field for projects that have it set on Monday.

## Non-goals

- No new endpoints, no new pages.
- No batch / one-time backfill script — incremental sync handles it.
- No edit UI for Fintech Parent on the project detail page in this change.

## Rollback plan

Pure additive. To roll back: remove the `MONDAY_COLUMN_TITLE_MAP` entry, drop the schema key, drop the field-mapping default. The `details.fintech_parent` values already written remain on the rows but go ignored by the derivation (the function still works either way — it just checks for a non-empty string).

## Affected teams

- **PMO** — primary beneficiaries. Fintech projects will correctly tag and filter from the next sync onward.
- **Engineering** — confirm the Monday column title before merging the adapter change. The probe script provides the authoritative answer.
