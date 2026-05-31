## ADDED Requirements

### Requirement: Per-project link to Harvest
A Torii Project MAY be linked to exactly one Harvest project. The link is stored in a nullable `projects.harvest_project_id` TEXT column. A unique index MUST prevent two Torii projects from linking to the same Harvest project. The link is established and removed exclusively through admin-only endpoints; PMs and Viewers cannot change it.

#### Scenario: Admin links a Torii project to a Harvest project
- **GIVEN** an admin and a Torii project with no Harvest link
- **WHEN** the admin sends `POST /api/projects/:id/harvest/link` with `{ harvestProjectId: "39571483" }`
- **THEN** the project's `harvest_project_id` is set to `"39571483"`, the response is 200, and subsequent reads of the project surface the link

#### Scenario: Linking the same Harvest project twice is rejected
- **GIVEN** project A is already linked to Harvest project `"39571483"`
- **WHEN** an admin tries to link project B to the same `"39571483"`
- **THEN** the API responds 400 with a clear "already linked to another project" message; project B's link is unchanged

#### Scenario: Linking to an unknown Harvest project is rejected
- **GIVEN** an admin with a valid Harvest connection
- **WHEN** they POST `{ harvestProjectId: "nonexistent" }`
- **THEN** the API calls `adapter.getProject("nonexistent")`, gets null, and responds 400; no row is updated

#### Scenario: Non-admin cannot link
- **GIVEN** a PM (not admin) user
- **WHEN** they POST `/api/projects/:id/harvest/link`
- **THEN** the API responds 403; the link is unchanged

#### Scenario: Unlink clears the link and deletes the cached snapshot
- **GIVEN** an admin and a linked project with a cached snapshot row
- **WHEN** they send `DELETE /api/projects/:id/harvest/link`
- **THEN** the project's `harvest_project_id` is cleared AND the row in `project_harvest_snapshots` is deleted (single transaction); response is 204

### Requirement: Cached Harvest snapshot per linked project
The system SHALL cache the hours data for each linked project in a `project_harvest_snapshots` table keyed on `project_id`. The cached row MUST include: `fetched_at` timestamp, `budget_hours` (nullable NUMERIC(10,2)), `spent_hours_billable` and `spent_hours_nonbillable` (NUMERIC(10,2) NOT NULL DEFAULT 0), and `breakdown` (JSONB array of per-(task, person) line items with hours only — no monetary fields). The full Harvest API payload (which DOES include cost fields) SHOULD be retained in a `raw` JSONB column for debugging; that raw payload MUST NOT be exposed by any API surface or UI in this capability.

The `breakdown` JSON shape MUST be exactly:

```
Array<{
  taskId: string,
  taskName: string,
  taskBudgetHours: number | null,
  taskSpentHours: number,
  people: Array<{ personId: string, personName: string, hours: number, archived?: boolean }>
}>
```

No monetary keys (`costCents`, `taskCostCents`, `totalProjectFeesCents`, etc.) are permitted in the projected `breakdown` or in the snapshot row's typed columns.

A refresh MUST upsert this row by `project_id`. Deleting the project (or unlinking) MUST cascade-delete the snapshot row.

#### Scenario: First refresh creates the snapshot row
- **GIVEN** a linked project with no snapshot row
- **WHEN** `POST /api/projects/:id/harvest/refresh` is called by a PM
- **THEN** the adapter's `getProjectSnapshot` is invoked, a new `project_harvest_snapshots` row is inserted, and the response is 200 with the snapshot payload

#### Scenario: Subsequent refresh updates the existing row
- **GIVEN** a linked project with an existing snapshot from 30 minutes ago
- **WHEN** refresh is called again
- **THEN** the SAME row is updated (not a duplicate), `fetched_at` advances to NOW(), and `spent_hours_*` / `*_cents` reflect the new Harvest data

#### Scenario: Snapshot persists the per-(task, person) breakdown
- **GIVEN** a Harvest project with tasks "03-Development" and "00-Project Management"
- **WHEN** the snapshot is refreshed
- **THEN** `breakdown` is a JSON array with one entry per task, each carrying `taskName`, `taskBudgetHours`, `taskSpentHours`, and a `people` array of `{personId, personName, hours}` rows — NO monetary fields

#### Scenario: Snapshot row rejects cost fields in the projected breakdown
- **GIVEN** a Harvest API response that includes `cost` keys on task or person rows
- **WHEN** the adapter projects the response into `HarvestSnapshot`
- **THEN** the projection strips all cost / fee / invoice keys before persisting; the `breakdown` JSONB column NEVER contains a monetary key

#### Scenario: Snapshot deletion cascades from project deletion
- **GIVEN** a linked project with a cached snapshot
- **WHEN** the project row is deleted
- **THEN** the snapshot row is deleted by the FK cascade

### Requirement: Snapshot read endpoint
The system SHALL expose `GET /api/projects/:id/harvest` returning the cached snapshot to any authenticated user. The response shape MUST match `HarvestSnapshotSchema`. When no link exists OR no snapshot row exists, the response MUST be 404.

#### Scenario: Authenticated user reads the snapshot
- **GIVEN** a linked project with a cached snapshot
- **WHEN** any authenticated user reads `/api/projects/:id/harvest`
- **THEN** the response is 200 with the full snapshot including `breakdown`

#### Scenario: No snapshot returns 404 (distinct from "no link")
- **GIVEN** a project that IS linked but has never been refreshed
- **WHEN** a client reads `/api/projects/:id/harvest`
- **THEN** the response is 404 with a body indicating "snapshot not yet fetched — refresh first"

#### Scenario: Unauthenticated request is rejected
- **WHEN** an unauthenticated client reads `/api/projects/:id/harvest`
- **THEN** the response is 401

### Requirement: Refresh endpoint
The system SHALL expose `POST /api/projects/:id/harvest/refresh` to fetch a fresh snapshot from Harvest. The endpoint MUST be callable by PM-or-higher users; Viewers MUST receive 403. When the project has no Harvest link, the response MUST be 404. When the Harvest API returns 429 (rate-limited), the endpoint MUST surface it as a 429 response with a body indicating the rate-limit window.

#### Scenario: PM refreshes a linked project
- **GIVEN** a PM and a linked project
- **WHEN** they POST `/api/projects/:id/harvest/refresh`
- **THEN** the adapter is called, the snapshot is upserted, and the response is 200 with the new payload

#### Scenario: Viewer cannot refresh
- **GIVEN** a Viewer
- **WHEN** they POST `/api/projects/:id/harvest/refresh`
- **THEN** the response is 403; no Harvest call is made

#### Scenario: Refresh on unlinked project
- **GIVEN** a project with no Harvest link
- **WHEN** any user POSTs the refresh endpoint
- **THEN** the response is 404

#### Scenario: Harvest rate limit surfaces as 429
- **GIVEN** the Harvest API responds 429 to `getProjectSnapshot`
- **WHEN** a PM hits the refresh endpoint
- **THEN** the API responds 429 with a body indicating "Harvest rate-limited; retry in 15s"; the cached snapshot row is NOT modified

### Requirement: Bulk-refresh on the scheduled sync
The scheduled tracker sync (every 30 minutes) SHALL refresh the snapshot for every project linked to a Harvest project on an active connection. To respect Harvest's 100 req / 15 sec rate limit, the bulk refresh MUST issue calls in batches of at most 50, sleeping at least 15 seconds between batches. A 429 on any single project MUST log a warning and continue with the remaining projects.

#### Scenario: Scheduled bulk refresh paces calls
- **GIVEN** 200 Torii projects linked to Harvest and an active Harvest connection
- **WHEN** the scheduled sync runs
- **THEN** the engine issues at most 50 `getProjectSnapshot` calls per 15-second window; total runtime ≥ 45 seconds for 200 projects; every snapshot row's `fetched_at` advances; per-project 429 errors are isolated and logged

### Requirement: Derived `overBudget` on the project read API
The project read shape returned by `GET /api/projects` and `GET /api/projects/:id` SHALL include a boolean field `overBudget` derived from the cached Harvest snapshot:

```
overBudget = (snapshot.spent_hours_billable + snapshot.spent_hours_nonbillable) > snapshot.budget_hours
```

The field MUST be `false` when: no snapshot row exists, `budget_hours` is NULL, or `budget_hours` is 0. The field MUST NOT be persisted as a column and MUST NOT be writable on POST/PATCH.

#### Scenario: Spent exceeds budget
- **GIVEN** a project whose snapshot has `spent_hours_billable = 683.50`, `spent_hours_nonbillable = 155.00`, `budget_hours = 615`
- **WHEN** a client reads the project
- **THEN** the response includes `overBudget: true`

#### Scenario: Spent equals budget
- **GIVEN** a project whose total spent equals its budget exactly
- **WHEN** a client reads the project
- **THEN** the response includes `overBudget: false` (strict greater-than, not greater-than-or-equal)

#### Scenario: No budget set is not over budget
- **GIVEN** a project whose snapshot has `budget_hours = NULL` (no budget set in Harvest)
- **WHEN** a client reads the project
- **THEN** the response includes `overBudget: false`

#### Scenario: No snapshot is not over budget
- **GIVEN** a project with no Harvest link or no cached snapshot
- **WHEN** a client reads the project
- **THEN** the response includes `overBudget: false`

#### Scenario: List endpoint joins the snapshot table
- **GIVEN** 100 projects in the system (50 linked, 50 not)
- **WHEN** a client reads `GET /api/projects`
- **THEN** the response includes `overBudget` for every project; the API issues at most one additional SQL query (LEFT JOIN), not 100

### Requirement: HarvestPanel on the project detail page
The system SHALL render a `<HarvestPanel>` section on the project detail page when the project is linked to a Harvest project. The panel MUST display:

- A "View in Harvest →" external link to `https://<workspace>.harvestapp.com/projects/<harvest_project_id>` (workspace name comes from the connection's `workspace` field).
- The last-refresh timestamp (e.g., "Updated 2 minutes ago").
- A "Refresh from Harvest" button visible to PMs only.
- Hours-only metric tiles: Total hours (with Billable / Non-billable subdivisions), Budget hours, Budget remaining (signed hours + signed percentage + a progress bar that overflows visually when > 100%). The panel MUST NOT render any monetary tiles (no Internal costs, no Invoiced amount, no Uninvoiced amount, no Total project fees).
- An expandable per-(task, person) breakdown table: one row group per Harvest task; person rows inside each group display the person's name and hours ONLY (no cost column). When a person's name matches the project's `details.project_manager`, `details.solution_architect`, or `details.solution_consultant`, the corresponding `PM` / `SA` / `SC` role badge MUST be rendered next to their name.

When the project is linked but has no snapshot yet, the panel MUST show a "Not yet refreshed" empty state with a Refresh button (PM only).

#### Scenario: PM views the panel for a linked project
- **GIVEN** a PM and a linked project with a fresh snapshot
- **WHEN** they open the project detail page
- **THEN** the HarvestPanel renders with the seven metric tiles populated, the "View in Harvest →" link points to the correct URL, and a "Refresh from Harvest" button is visible

#### Scenario: Viewer sees the panel without the Refresh button
- **GIVEN** a Viewer and the same linked project
- **WHEN** they open the project detail page
- **THEN** the panel renders the metric tiles + breakdown; the Refresh button is NOT rendered

#### Scenario: PM/SA/SC role badges appear on cross-referenced people
- **GIVEN** a linked project whose `details.project_manager = "Joao Garcia"` and a snapshot whose breakdown has a row for "Joao Garcia" under task "00-Project Management"
- **WHEN** the panel renders
- **THEN** the row for Joao Garcia carries a "PM" badge

#### Scenario: Unlinked project hides the panel
- **GIVEN** a project with no `harvest_project_id`
- **WHEN** any user opens the project detail page
- **THEN** the HarvestPanel is NOT rendered

### Requirement: Budget chip in the project detail header
The system SHALL render an `<OnBudgetChip>` next to the existing `<StateBadge>` in the project header band when the project has a cached snapshot. The chip MUST render:

- "On budget" with a green style when `overBudget === false`.
- "Over budget −N%" with a red style when `overBudget === true`, where N = `Math.round((spent - budget) / budget * 100)`.

When no snapshot exists, the chip MUST NOT render (no "On budget" with no data).

#### Scenario: Over-budget project shows red chip with percentage
- **GIVEN** the Abrigo example (spent 838.50h, budget 615h → -36%)
- **WHEN** a user opens the project detail page
- **THEN** the chip reads "Over budget −36%" in red

#### Scenario: Under-budget project shows green chip
- **GIVEN** a project with spent 300h, budget 615h
- **WHEN** a user opens the project detail page
- **THEN** the chip reads "On budget" in green

#### Scenario: No snapshot hides the chip
- **GIVEN** a project with no Harvest link or no cached snapshot
- **WHEN** a user opens the project detail page
- **THEN** no chip is rendered next to the State badge

### Requirement: Cost and invoicing data are not surfaced
This capability SHALL NOT display or expose any monetary or invoicing data from Harvest — neither internal costs, nor invoiced amounts, nor uninvoiced amounts, nor total project fees, nor per-person cost. The Harvest API surface, the snapshot's typed schema, the `breakdown` JSON, the read API, and the HarvestPanel UI all omit these fields. The Harvest workspace remains the authoritative location for any cost or invoicing data. See design D9.

The raw Harvest API payload retained in `project_harvest_snapshots.raw` MAY contain cost fields (it's stored verbatim for debugging), but no API endpoint or UI in this capability — or any other — exposes that column to clients.

#### Scenario: Read API omits monetary fields
- **GIVEN** any linked project with a fresh snapshot
- **WHEN** any user reads `GET /api/projects/:id/harvest`
- **THEN** the response body has NO `internalCostsCents`, `invoicedAmountCents`, `uninvoicedAmountCents`, `totalProjectFeesCents`, or per-person `costCents` keys

#### Scenario: HarvestPanel renders only hours-based tiles
- **GIVEN** a PM and a linked project with a snapshot
- **WHEN** the HarvestPanel renders
- **THEN** the visible tiles are limited to Total hours, Billable, Non-billable, Budget hours, and Budget remaining; no cost / invoicing / fees tiles are rendered

#### Scenario: Breakdown table shows hours only
- **GIVEN** a snapshot whose breakdown includes a task with several people
- **WHEN** the HarvestPanel renders the breakdown
- **THEN** each person row shows the person's name and their hours; there is NO cost column on the row
