## Context

Torii projects currently surface five fields (`name`, `phase`, `state`, `owner`, `target_go_live`). Richer engagement data lives on the Monday boards and in the per-project `tracker_raw` snapshot (added by `add-monday-project-details`), but nothing structured reads it. This change promotes eleven business fields to first-class, hybrid-owned project data and renders them in the list and detail UIs with per-user column visibility and client-side sorting.

The existing field-ownership model (`field_mapping: { <dotted-key>: 'torii' | 'monday' }`) and the `keyDates` JSON column already establish the pattern this change follows for storage and merge.

## Goals / Non-Goals

**Goals:**
- Store eleven new string fields per project under one `details` JSON column.
- Default them from Monday on sync, PM-overridable per field via `field_mapping`.
- List page: render as columns, per-user show/hide (server-persisted), client-side sort.
- Detail page: render all eleven; link fields as anchors; PM-edit for torii-owned fields.

**Non-Goals:**
- Person relations for people fields (plain text this round).
- Server-side sort/pagination.
- Tenant-configurable Monday column mapping (fixed documented map).
- Column reordering / width persistence.

## Decisions

### Storage: one `details` JSON column, not eleven columns

Add `details JSONB` to `projects`, holding `{ project_manager?, solution_architect?, solution_consultant?, banking_core?, primary_contact?, status_report_url?, jira_project_url?, customer_type?, finance_use_case?, use_case_group?, customer_status? }` — all optional strings.

Rationale: mirrors the existing `keyDates` pattern; field-ownership already uses dotted keys (`key_dates.target_go_live`), so `details.project_manager` slots in with zero new ownership machinery; avoids eleven migrations and keeps the set easy to extend.

**Alternatives:** eleven typed columns (rejected — migration churn, no query benefit since sort is client-side); reuse `tracker_raw` directly (rejected — that's an unstructured provider-shaped snapshot, not stable Torii fields, and isn't PM-editable).

### Ownership: hybrid via existing `field_mapping`

Each field gets a default-mapping entry `details.<key>: 'monday'`. The merge writes a `details.<key>` only when its owner is `monday`; a PM can flip any key to `torii` to pin a manual value. This reuses `mergeExternalIntoTorii` semantics — extend it to walk `details.*` keys the same way it handles `name` and `key_dates.target_go_live`.

### Monday extraction: fixed title→key map in the adapter

The Monday adapter resolves each `details.<key>` by matching a documented set of board-column titles, confirmed against live synced data. `ExternalProject` gains an optional `details: Record<string,string>` populated from `column_values[].text`. Unmatched columns are ignored (still captured verbatim in `tracker_raw`).

Final field map (12 fields):

| Torii key | UI label | Monday column | Default owner |
|---|---|---|---|
| `project_manager` | Project Manager | `Project Manager` | monday |
| `solution_architect` | Solution Architect | `Solution Architect` | monday |
| `solution_consultant` | Solution Consultant | `Senior Consultant` | monday |
| `core_solution` | Core Solution | `Core Solution` | monday |
| `core_vendor` | Core Vendor | `Core` | monday |
| `primary_contact` | Primary Contact | _(none)_ | torii |
| `status_report_url` | Status Report | `Status Report` (link) | monday |
| `jira_project_url` | Jira Project | `Jira` (link) | monday |
| `customer_type` | Customer Type | `Customer Type` | monday |
| `finance_use_case` | Finance - Use Case | `Finance - Use Case` | monday |
| `use_case_group` | Use Case - Group | `Use Case - Group` | monday |
| `customer_status` | Customer Status | `Customer Status` | monday |

`primary_contact` has no Monday source, so it defaults to `torii` ownership (PM-managed) and is never written by sync.

**Trade-off:** tenant-specific column titles won't map. Accepted for this iteration; the raw snapshot remains the escape hatch, and a future change can make the map configurable.

### Column value resolution: display_value for mirror/board_relation

Most of the mapped columns are not plain text. As confirmed against live data, the column types are:

- `link` — `Status Report`, `Jira` (value in `text`, formatted `"Label - url"`)
- `board_relation` — `Project Manager`, `Solution Architect`, `Senior Consultant`, `Core Solution`, `Finance - Use Case`
- `mirror` — `Core`, `Customer Type`, `Use Case - Group`, `Customer Status`

For `mirror` and `board_relation` columns, both `text` and `value` are empty in the GraphQL response; the human-readable value is exposed only via `display_value` on the `MirrorValue` / `BoardRelationValue` GraphQL types. The adapter therefore (1) requests `display_value` through inline fragments (`... on MirrorValue { display_value } ... on BoardRelationValue { display_value }`), (2) pins a Monday `API-Version` (`2024-10`) that exposes it, and (3) resolves each mapped column as `display_value ?? text`.

### Link columns: extract the URL from `"Label - url"` text

The `Status Report` and `Jira` link columns resolve to text formatted `"Label - https://url"` (e.g., `"PES-31619 - https://portx.atlassian.net/browse/PES-31619"`). After resolving the column value (above), the adapter SHALL extract the first `https?://…` token as the stored value for `status_report_url` / `jira_project_url`. If no URL is present, the field is omitted. Sync writes go directly to the DB (bypassing API Zod validation), so odd Monday values never block a sync; only PM manual edits via PATCH are URL-validated.

### Default-visible columns

The list shows base columns (name, phase, state, owner, target_go_live) plus, by default, `project_manager`, `solution_architect`, `core_solution`, `core_vendor`. The remaining eight detail columns are hidden by default and toggleable per user.

### Column visibility: new `user-preferences` capability, server-persisted

A `UserPreference` row keyed by `person_id` stores a JSON blob; this change uses `hiddenProjectColumns: string[]`. New endpoints `GET /api/me/preferences` and `PUT /api/me/preferences` (upsert). The list page loads prefs on mount, toggling a column writes back. Default = all columns visible (empty hidden set).

**Alternatives:** localStorage (rejected per product decision — must follow the user across devices); a column on `Person` (rejected — a dedicated table keeps UI prefs from bloating the domain entity and leaves room for future pref types).

### Sorting: client-side over fetched rows

The list already fetches all rows. Sorting (including by `details.*`) happens in the browser comparator. This sidesteps the documented JSON-path sort limitation in the list endpoint and works uniformly for every column. Link columns sort by their string value; empty values sort last.

### List UX sequence

```
mount
 ├─ GET /api/projects            → rows (now include `details`)
 └─ GET /api/me/preferences      → hiddenProjectColumns
        │
        ▼
 render visible columns; user clicks a header → client-side re-sort
 user toggles a column in the column menu → PUT /api/me/preferences (optimistic)
```

## Risks / Trade-offs

- **Monday title drift** → if a board renames "Banking Core", that field stops syncing silently. Mitigation: log unmatched-but-expected titles during sync; raw snapshot still holds the data; future configurable mapping.
- **Wide list table** → eleven extra columns can overflow horizontally. Mitigation: default-hide the lower-priority columns, horizontal scroll, and the per-user show/hide control.
- **Preferences write churn** → toggling columns hits the API each time. Mitigation: optimistic UI + debounce; payload is tiny.
- **Plain-text people fields** → no validation that "Project Manager" matches a real Person; duplicates/typos possible. Accepted per product decision; revisit if capacity linkage is wanted.
- **Migration safety** → additive nullable column + new table; safe online, no backfill (fields populate on next sync or manual edit).

## Migration Plan

1. Apply migration: add `projects.details JSONB` (default `{}`), create `user_preferences` table.
2. Deploy API + web together; `details` and preferences endpoints are additive, so staged rollout is safe.
3. No backfill — `details` populates on the next per-project sync (or PM edit). Users can click Sync Now to populate immediately.
4. Rollback: drop the column and table, redeploy prior API/web.

## Open Questions

- Should the two URL fields render with link validation / favicon, or plain anchors? (Assume plain anchors with `rel="noreferrer"`.)
- Which subset of the eleven columns should be visible by default vs hidden? (Proposed default-visible: project_manager, customer_status, banking_core; rest hidden — confirm during apply.)
- Do we want an audit entry when a PM overrides a Monday-owned field to torii-owned? (Out of scope unless requested.)
