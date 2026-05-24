# dashboard-views Specification

## Purpose
TBD - created by archiving change add-integration-dashboard. Update Purpose after archive.
## Requirements
### Requirement: Project list view
The system SHALL provide a list view at `/projects` rendering one row per project with columns: `name`, `phase`, `state`, `owner`, `target_go_live`, and a tracker badge (`monday` icon if `tracker_ref` is set). The view MUST support filtering by `phase`, `state`, and `owner`, and sorting by `name` and `target_go_live`.

#### Scenario: Filter by state
- **GIVEN** projects in states `OnTrack`, `AtRisk`, and `Blocked`
- **WHEN** the user selects the `Blocked` state filter
- **THEN** only projects with state `Blocked` are rendered

#### Scenario: Empty state
- **GIVEN** zero projects in the system
- **WHEN** an authenticated user opens `/projects`
- **THEN** the page renders an empty-state panel with a "Create project" call to action

### Requirement: Project detail view
The system SHALL provide a detail view at `/projects/{id}` that renders the project's name, phase, state, owner, all four key dates, the tracker badge with last-sync timestamp (if linked), an editable phase/state control (PM role only), an editable key-dates panel (PM role only), a "Refresh from tracker" button (visible only when linked), and the project's current allocations.

#### Scenario: PM edits phase from detail view
- **GIVEN** an authenticated PM viewing a project in phase `Build`
- **WHEN** they change the phase control to `UAT` and confirm
- **THEN** the system persists the change, refreshes the panel, and the audit log records the transition

#### Scenario: Viewer cannot see edit controls
- **GIVEN** an authenticated user with role `Viewer`
- **WHEN** they open the detail view
- **THEN** edit controls and the "Refresh from tracker" button are not rendered

### Requirement: Capacity view
The system SHALL provide a capacity view at `/capacity` defaulting to a 12-week window starting from the current week. The primary panel MUST render team-level demand as a weekly heatmap (one column per week, one row per project, cell shaded by total weekly demand). Clicking any week column MUST open a per-person drill-down panel showing every person's committed `pct` for that week, with rows for over-allocated people visually flagged.

#### Scenario: Default view renders 12 weeks
- **WHEN** an authenticated user opens `/capacity`
- **THEN** the heatmap renders 12 columns starting from the current ISO week

#### Scenario: Drill-down on a specific week
- **GIVEN** the capacity view is rendered
- **WHEN** the user clicks the column header for the week of 2026-07-06
- **THEN** a side panel opens listing every person with their committed `pct` for that week, sorted descending, with over-allocated rows visually flagged

### Requirement: Navigation shell
The system SHALL render a persistent navigation shell with links to `Projects`, `Capacity`, and (for admins only) `Trackers`. The shell MUST show the signed-in user's name and a sign-out action.

#### Scenario: Admin sees Trackers link
- **GIVEN** an authenticated user with `PM` role and `is_admin=true`
- **WHEN** any page in the app is rendered
- **THEN** the navigation includes a `Trackers` link

#### Scenario: Non-admin does not see Trackers link
- **GIVEN** an authenticated user with `is_admin=false`
- **WHEN** any page is rendered
- **THEN** the `Trackers` link is not present in the navigation

### Requirement: Project detail page surfaces the tracker payload

The project detail view SHALL render a "Monday details" panel for any project linked to a Monday tracker. The panel MUST display the Monday item identifier and row title for traceability, MUST tabulate every populated column from the last-synced payload showing the column title (with id fallback), the text value, and the column type, and MUST provide a toggle to reveal or hide the raw JSON payload for debugging. Projects without a tracker link MUST NOT render the panel.

#### Scenario: Panel hidden for projects without a tracker link
- **GIVEN** a Torii project with `tracker_ref` set to null
- **WHEN** a user opens the project detail page
- **THEN** the Monday details panel is not rendered

#### Scenario: Panel renders identity for linked project
- **GIVEN** a Torii project linked to a Monday item with a fetched payload
- **WHEN** a user opens the project detail page
- **THEN** the panel displays the Monday item id and row title from the stored payload

#### Scenario: Panel tabulates populated columns
- **GIVEN** a Monday payload whose `column_values` include a `Status` column with text "On track" and an empty `Owner` column
- **WHEN** the panel renders
- **THEN** the Status row appears in the table (title "Status", value "On track", type as reported by Monday) and the empty Owner column is omitted

#### Scenario: Empty-columns state
- **GIVEN** a Monday payload whose `column_values` are all empty or absent
- **WHEN** the panel renders
- **THEN** the panel shows an empty-state message instead of a column table

#### Scenario: Raw JSON toggle
- **GIVEN** the Monday details panel is rendered with a payload
- **WHEN** the user clicks "Show raw JSON"
- **THEN** the full payload is rendered as formatted JSON below the column table; clicking again hides it

#### Scenario: No snapshot yet
- **GIVEN** a linked Torii project whose `tracker_raw` is null because no sync has succeeded yet
- **WHEN** a user opens the project detail page
- **THEN** the panel shows a message indicating no snapshot is available and prompts the user to sync from the tracker

### Requirement: Project list response excludes tracker payload

The `GET /api/projects` list response MUST NOT include the `tracker_raw` snapshot for any project. The snapshot MUST be returned only by `GET /api/projects/:id`.

#### Scenario: List endpoint omits snapshot
- **WHEN** a client calls `GET /api/projects`
- **THEN** no element in the response has a `trackerRaw` field

#### Scenario: Detail endpoint includes snapshot
- **GIVEN** a linked Torii project with a populated `tracker_raw`
- **WHEN** a client calls `GET /api/projects/:id`
- **THEN** the response includes `trackerRaw` set to the stored payload, or `null` if the project has no snapshot yet

