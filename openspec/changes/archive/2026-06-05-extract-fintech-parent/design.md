## Constraints

- The derivation function (`deriveProjectType` in `packages/shared/src/enums.ts`) already correctly maps `details.fintech_parent → 'fintech'`. No logic change there; the field just needs to be populated.
- `ProjectDetailsSchema` is `.strict()`. The schema explicitly rejects unknown keys, so even though `Project.details` is JSONB and the DB would accept anything, the API surface would 400 a PATCH carrying `fintech_parent` today. Both the schema and the sync write path must learn the key together.
- The Monday sync owns the source of truth. Adding the key to the schema without adding the Monday extraction would leave the field reachable only through PATCH, and we'd still see `'direct'` for every project after sync (since sync's `extractDetails` would not write the key, and any PATCH-set value could be overwritten on next sync depending on field_mapping).
- `MONDAY_COLUMN_TITLE_MAP` is title-keyed, not column-id-keyed. Monday's column IDs can vary per board; titles are the stable cross-board identifier the existing extraction depends on. New entries follow the same convention.
- We do NOT know the exact Monday column title from this side of the boundary. The comment on `MONDAY_COLUMN_TITLE_MAP` reads `// Confirmed against live synced data` — we have to do the same.

## Decisions

### D1 — Confirm the Monday column title before merging

The proposal assumes the column is `'Fintech Parent'`. Two reasons this needs a live check:

1. Monday board titles are PM-edited and have shifted over time.
2. There's no compile-time signal in the existing extraction code if the title is wrong — sync just silently drops the column, exactly like today.

Procedure for the implementer: run `apps/api/scripts/probe-monday-project.ts <projectId>` against a known-fintech project and read the column titles in the dump. The mapping in the adapter uses whatever exact title appears (case-sensitive — the existing entries match exactly e.g. `'Project Manager'`, `'Senior Consultant'`).

If the column doesn't exist on Monday at all, this change cannot proceed as drafted — the PM team needs to add the column to the board first, and we'd revisit the proposal.

### D2 — Monday-owned by default, PM-overridable via field_mapping

Every other detail field sourced from Monday lives in the default field_mapping with owner `monday`, and the existing per-key override path (the field-mapping UI on the project detail page) lets a PM override on a per-project basis. `details.fintech_parent` follows the same pattern. Reasoning:

- Consistency with the rest of the details fields. PMs already know how to override.
- The "Fintech Parent" value rarely changes once set on Monday; PortX's escape hatch for the few edge cases is the per-project override, not a Torii-only edit field.
- Keeps PM workflow unchanged — Monday remains the canonical place to tag fintech projects.

If the field needs to become editable from Torii later (e.g., PMs prefer setting it in Torii first), that's a follow-up change adding a form field on the project detail page. The schema change here already permits PATCH-writes.

### D3 — No backfill script

The next sync pass populates `fintech_parent` for any project whose linked Monday item has the column set. Two paths trigger that:

- The 6h sync cron (when enabled).
- Any admin-driven `POST /api/tracker/monday/sync` (the existing per-tracker sync endpoint).

We could write a one-shot script that runs sync immediately at deploy time, but it's not justified: the field is already wrong today and waiting one cron cycle for it to come right doesn't move the needle. The probe script provides a one-off verification path if a specific project is urgent.

### D4 — Place `fintech_parent` in PROJECT_DETAIL_KEYS but NOT in PROJECT_DETAIL_FIELDS (web)

`PROJECT_DETAIL_KEYS` is the strict API-level key list (the source of truth for what `ProjectDetails` carries). `fintech_parent` belongs there because the API now accepts and returns it.

`PROJECT_DETAIL_FIELDS` (in `apps/web/src/api/endpoints.ts`) is the web-side render list — fields the project detail page shows in its groups. We deliberately leave `fintech_parent` OUT of that list in v1, for two reasons:

1. The value is already surfaced indirectly through `projectType: 'fintech' | 'direct'`, which renders on the project list and detail headers.
2. Rendering it as an editable form field would imply Torii ownership, which contradicts D2.

If a future change adds an edit UI, that's where `PROJECT_DETAIL_FIELDS` gets extended.

### D6 — Two Monday columns, "Fintech Parent" preferred, "Fintech" as fallback

Live data confirmed the Monday board exposes TWO related columns: `"Fintech Parent"` and `"Fintech"`. They are usually set to the same value on fintech engagements, but occasionally only `"Fintech"` is populated. The Torii projection collapses these into one `details.fintech_parent` field:

- If `"Fintech Parent"` has a non-empty value, use it.
- Else if `"Fintech"` has a non-empty value, use it.
- Otherwise leave the key absent.

This precedence is enforced in `extractDetails` rather than via `MONDAY_COLUMN_TITLE_MAP`, because the map is designed for 1:1 title→key relationships and JS object literal insertion order would otherwise make "whichever column appears later in `column_values` wins" — i.e., non-deterministic across Monday API responses. A small explicit block after the main extraction loop reads both candidates and applies the preference deterministically.

Both columns are text (not a link), so no `URL_DETAIL_KEYS` membership applies.

### D5 — Existing projects' field_mapping is preserved

We do NOT migrate existing projects' `field_mapping` JSON to retroactively add an entry for `details.fintech_parent`. The merge engine already treats absent entries on a Monday-sourced default field as Monday-owned (verified in `apps/api/src/sync/engine.ts`'s field-resolution path; existing tests exercise this for `details.core_solution` etc.). New projects synced after this change will be created with the new default. Both cases converge on the same behavior.
