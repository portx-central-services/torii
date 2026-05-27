## Why

PMs and leadership need engagement context (who staffs it, where the customer is, where to read status) directly in Torii's project list and detail pages. Today only `name`, `phase`, `state`, `owner`, and `target_go_live` are surfaced; everything else lives in Monday and forces a context switch. Eleven business fields already exist on the Monday boards, so we can default them from sync while letting PMs override per-field, then render them as toggleable, sortable columns.

## What Changes

- Add twelve project detail fields, stored together in a new `details` JSON column on `Project`: `project_manager`, `solution_architect`, `solution_consultant`, `core_solution`, `core_vendor`, `primary_contact`, `status_report_url`, `jira_project_url`, `customer_type`, `finance_use_case`, `use_case_group`, `customer_status`. People-role fields are plain text (not Person relations).
- Map each field to a concrete Monday board column (confirmed against live synced data): Project Manager→`Project Manager`, Solution Architect→`Solution Architect`, Solution Consultant→`Senior Consultant`, Core Solution→`Core Solution`, Core Vendor→`Core`, Status Report→`Status Report`, Jira Project→`Jira`, Customer Type→`Customer Type`, Finance - Use Case→`Finance - Use Case`, Use Case - Group→`Use Case - Group`, Customer Status→`Customer Status`. `primary_contact` has no Monday source and is Torii-managed.
- Treat Monday-mapped fields as **hybrid**: Monday-owned by default, PM-overridable via the existing `field_mapping` ownership model. Sync extracts them from Monday columns and only writes fields whose owner is `monday`. `primary_contact` defaults to `torii`.
- The two link fields (`status_report_url`, `jira_project_url`) come from Monday link columns whose text is `"Label - https://url"`; the adapter extracts the URL portion for storage.
- Extend the project list page to render the new fields as columns, with per-user **show/hide** controls and **client-side sorting** on every new column.
- Persist each user's column-visibility preferences **server-side** so they follow the user across devices (new `user-preferences` capability + API).
- Render the same eleven fields on the project detail page, with the two link fields as clickable anchors. PMs can edit any field whose owner is `torii`.

## Capabilities

### New Capabilities
- `user-preferences`: Per-user, server-persisted UI preferences — initially the set of hidden columns on the project list page.

### Modified Capabilities
- `project-lifecycle`: The Project entity gains a `details` map holding the eleven new string fields; create/update accept and validate them.
- `tracker-import`: The default `field_mapping` extends to mark the eleven `details.*` fields Monday-owned, and the Monday adapter extracts them from board columns into the merge.
- `dashboard-views`: The project list view gains the eleven columns plus show/hide and client-side sort; the project detail view renders the eleven fields with link fields as anchors.

## Impact

- **Affected code**: `apps/api/prisma/schema.prisma` (+`details` on Project, new `UserPreference` model), new migration, `packages/shared` (field keys, default mapping, validation schema), `apps/api/src/sync/monday/MondayAdapter.ts` (+`details` extraction), `apps/api/src/sync/merge-fields.ts` (+`details` merge), `apps/api/src/routes/projects.ts` (serialize + validate `details`), new `apps/api/src/routes/preferences.ts`, `apps/web/src/api/endpoints.ts`, `apps/web/src/routes/projects-list.tsx`, `apps/web/src/routes/project-detail.tsx`.
- **APIs**: `GET/PATCH /api/projects*` responses gain `details` (additive). New `GET/PUT /api/me/preferences` for column visibility.
- **Data**: one `details JSONB` column on `projects`; one new `user_preferences` table.

## Non-goals

- Linking people fields to Torii `Person` records or capacity planning — they are plain text this iteration.
- Server-side sorting or pagination of the list — sorting is client-side over the fetched rows.
- Auto-discovery of Monday column titles. The adapter maps a fixed, documented set of Monday column titles to `details.*` keys; tenant-specific remapping is out of scope.
- Validating that link fields are reachable URLs beyond basic format checking.
- Column reordering or width/persistence beyond show/hide.

## Rollback plan

- Schema: `details` is a nullable/defaulted JSONB column and `user_preferences` is a new table — both additive. Roll back with `ALTER TABLE projects DROP COLUMN details;` and `DROP TABLE user_preferences;`. Core data untouched.
- API: remove `details` from project serialization and delete the preferences routes. Additive fields, so older clients are unaffected.
- Sync: revert the `details` extraction/merge; behavior reverts to name + target_go_live only.
- UI: revert the list/detail components to their prior column sets.

## Affected teams

- **PMO** — primary consumers; gain staffing/customer context and personalized columns.
- **Integration Engineering** — Solution Architect/Consultant visibility.
- **Platform / IT** — apply one migration (one column + one table); no downtime.
