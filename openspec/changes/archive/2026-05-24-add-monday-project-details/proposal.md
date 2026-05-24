## Why

Torii currently persists only two fields from each Monday item — `name` and `target_go_live` — yet the underlying GraphQL query already fetches every column value. PMs viewing a Torii project have no way to see what Monday actually says about it (status, owner, custom columns) without bouncing to monday.com, and there is no audit trail of the last-synced payload when name/dates disagree across systems. Storing the full snapshot per project and surfacing it on the project detail page closes the trust gap without giving up Torii's per-field ownership model.

## What Changes

- Persist the raw last-synced Monday item payload on `Project` so all column data (status, person, dates, text, formulas) is retained alongside the merged fields.
- Refresh the stored snapshot on every successful per-item sync — bulk `syncConnection`, force-mode refresh, per-project `syncProject`, and initial/overwrite imports.
- Expose the snapshot only on `GET /api/projects/:id` (not on list responses) to avoid bloating the projects list payload.
- Add a "Monday details" panel to the project detail page that:
  - Surfaces the Monday item id and row title for traceability.
  - Tabulates every populated column as (column title, value, type).
  - Offers a Show/Hide raw JSON toggle for debugging.
- Preserve existing field-ownership rules: the snapshot is informational only and never overrides Torii-owned fields during merge.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `tracker-import`: Add a requirement that every successful per-item sync persists the raw external payload on the linked project, in addition to applying the merge.
- `dashboard-views`: Add a requirement that the project detail view renders a Monday details panel when the project is linked to a tracker.

## Non-goals

- Bidirectional write-back to Monday. The snapshot is read-only and informational.
- Per-column field mapping or auto-discovery of "phase-like" / "status-like" Monday columns. Field ownership for `name` and `target_go_live` remains the only structured merge.
- Historical snapshots. Each sync overwrites the previous payload; we are not keeping a time series.
- Surfacing the snapshot in the projects list view or any rollup query.
- Adapters other than Monday. The snapshot column is `Json?` so it can hold any provider's payload, but only Monday's parsing is in scope here.

## Rollback plan

- Schema: the new `projects.tracker_raw` column is nullable with no default. Drop with `ALTER TABLE projects DROP COLUMN tracker_raw;` — no data migration needed; existing rows are unaffected.
- API: remove `trackerRaw` from the `GET /api/projects/:id` response shape. No clients depend on it outside the new panel.
- UI: remove the `MondayDetailsPanel` component and its import from `project-detail.tsx`.
- Sync engine: revert the `trackerRaw` writes in `engine.ts` and `routes/tracker.ts`; behavior reverts to "merge only" semantics.

## Affected teams

- **PMO** — primary consumers; gain visibility into Monday columns without leaving Torii.
- **Integration Engineering** — debugging benefit (Show raw JSON toggle when name/date drift between systems).
- **Platform / IT** — must apply one nullable-column migration; no downtime.

## Impact

- **Affected code**: `apps/api/prisma/schema.prisma`, new migration directory, `apps/api/src/sync/engine.ts`, `apps/api/src/routes/tracker.ts`, `apps/api/src/routes/projects.ts`, `apps/web/src/api/endpoints.ts`, `apps/web/src/routes/project-detail.tsx`, `apps/api/test/sync-engine.test.ts`.
- **APIs**: `GET /api/projects/:id` response gains `trackerRaw` (additive, non-breaking).
- **Dependencies**: none new.
- **Storage**: one nullable JSONB column on `projects`. Each row's payload grows by roughly the size of one Monday item's column_values (typically a few KB).
