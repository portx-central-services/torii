# dashboard-views Specification

## Purpose
TBD - created by archiving change add-integration-dashboard. Update Purpose after archive.
## Requirements
### Requirement: Project list view
The system SHALL provide a list view at `/projects` rendering one row per project. The view MUST render the base columns `name`, `phase`, `state`, `owner`, `target_go_live`, and a tracker badge (`monday` icon if `tracker_ref` is set), plus a column for each `details` field: `project_manager`, `solution_architect`, `solution_consultant`, `core_solution`, `core_vendor`, `primary_contact`, `status_report_url` (rendered as a link), `jira_project_url` (rendered as a link), `customer_type`, `finance_use_case`, `use_case_group`, `customer_status`. The view MUST support filtering by `phase`, `state`, and `owner`. The view MUST support client-side sorting by any rendered column, including every `details` column, with empty values ordered last. The view MUST provide a per-user control to show or hide individual columns; hidden-column preferences MUST be persisted per user (see capability `user-preferences`). By default `project_manager`, `solution_architect`, `core_solution`, and `core_vendor` MUST be visible and the remaining detail columns hidden until the user shows them.

#### Scenario: Filter by state
- **GIVEN** projects in states `OnTrack`, `AtRisk`, and `Blocked`
- **WHEN** the user selects the `Blocked` state filter
- **THEN** only projects with state `Blocked` are rendered

#### Scenario: Empty state
- **GIVEN** zero projects in the system
- **WHEN** an authenticated user opens `/projects`
- **THEN** the page renders an empty-state panel with a "Create project" call to action

#### Scenario: Sort by a details column
- **GIVEN** projects with varying `details.customer_status` values, some empty
- **WHEN** the user clicks the `Customer Status` column header
- **THEN** the rows reorder client-side by that value and rows with an empty value sort last

#### Scenario: Hide a column
- **GIVEN** an authenticated user viewing `/projects`
- **WHEN** they hide the `Solution Consultant` column via the column control
- **THEN** the column is removed from the table and the preference is saved for that user

#### Scenario: Hidden columns persist across sessions
- **GIVEN** a user who previously hid the `Use Case - Group` column
- **WHEN** they open `/projects` again later (including on another device)
- **THEN** the `Use Case - Group` column is hidden on load

#### Scenario: Link columns render as anchors
- **GIVEN** a project with a non-empty `details.status_report_url`
- **WHEN** the list renders that row
- **THEN** the Status Report cell is a clickable anchor to that URL

### Requirement: Project detail view
The system SHALL provide a detail view at `/projects/{id}` that renders the project's name, phase, state, owner, all four key dates, all twelve `details` fields (with `status_report_url` and `jira_project_url` rendered as clickable anchors when set), the tracker badge with last-sync timestamp (if linked), an editable phase/state control (PM role only), an editable key-dates panel (PM role only), an editable details panel for `torii`-owned detail fields (PM role only), a "Refresh from tracker" button (visible only when linked), and the project's current allocations.

The view MUST present a clear visual hierarchy in which a compact header summarizes identity and current status, and supporting detail follows below. Each of phase, state, target go-live, and tracker-sync status MUST appear in exactly one canonical location; the view MUST NOT render the same fact in multiple standalone places (e.g., a status fact MUST NOT be repeated as both a header tile and a side panel). The header MUST show read-only phase and state; editable values MUST live only in their editor controls and MUST NOT be duplicated as separate read-only tiles.

The delivery timeline MUST be rendered as a horizontal timeline within the header (kickoff, target go-live, actual go-live, hypercare end, each marked done/active/upcoming) and MUST NOT also appear as a separate standalone section. The `actual_go_live` step MUST be omitted from the timeline when no `actual_go_live` date has been set. When `hypercare_end` is not explicitly set, the timeline MUST display a default value computed as four weeks after `actual_go_live` (if set) or four weeks after `target_go_live` (otherwise); when neither is set, the hypercare end step is shown unscheduled.

The "Refresh from tracker" action MUST appear as a small footer at the bottom of the page rather than inside the header. The footer MUST consolidate identifiers and sync metadata into a single muted meta line that includes the Torii `project.id`, and, when the project is linked, the tracker provider badge, the last-sync timestamp, and the external identifier; the Refresh button (PM only, linked only) sits to the right of that meta line. The footer renders for every project so the `project.id` is always available. The header card MUST NOT also render the project id or the provider badge.

The header card MUST present three vertical bands: a title row at the top (project name on the left, Phase and State indicators on the right as primary status), the horizontal delivery timeline as a full-width focal band in the middle, and a "project facets" band at the bottom that lists the remaining header-surfaced facets as uniform label-above-value cells in a responsive horizontal grid. Phase and State in the title row MUST be visually prominent (sized larger than ordinary facet values) — each rendered as a label-above-badge pair where the badge uses the project's status palette and is enlarged to read at a glance. The facets band MUST contain, in order: Team (`project_manager`, `solution_architect`, `solution_consultant`) and Links (`status_report_url`, `jira_project_url`). For Link fields the value cell renders an accent-colored hyperlink reading "Open ↗" that opens the URL, or `—` when no URL is set.

The twelve `details` fields MUST be organized into labeled subgroups rather than a single flat list, grouped as: **Team** (`project_manager`, `solution_architect`, `solution_consultant`), **Customer** (`customer_type`, `customer_status`, `primary_contact`), **Systems** (`core_solution`, `core_vendor`), **Use case** (`finance_use_case`, `use_case_group`), and **Links** (`status_report_url`, `jira_project_url`). The **Team** and **Links** subgroups MUST be surfaced in the header's facets band (described above); the Customer, Systems, and Use case subgroups appear in the Project details section. The page MUST remain a single scrolling view (no tabs).

The "Team allocations" panel MUST surface the project's team roster (the populated `details.project_manager`, `details.solution_architect`, and `details.solution_consultant` values) at the top of the panel as a read-only summary, alongside the formal Allocation rows.

#### Scenario: PM edits phase from detail view
- **GIVEN** an authenticated PM viewing a project in phase `Build`
- **WHEN** they change the phase control to `UAT` and confirm
- **THEN** the system persists the change, refreshes the panel, and the audit log records the transition

#### Scenario: Viewer cannot see edit controls
- **GIVEN** an authenticated user with role `Viewer`
- **WHEN** they open the detail view
- **THEN** edit controls and the "Refresh from tracker" button are not rendered

#### Scenario: Detail view renders the twelve fields in subgroups
- **GIVEN** a project with several `details` fields populated
- **WHEN** an authenticated user opens the detail view
- **THEN** the Team and Links subgroups are shown in the header's facets band alongside Phase and State, and the Customer, Systems, and Use case subgroups are shown in the Project details section

#### Scenario: Link fields in the facets band open the URL
- **GIVEN** a project with `details.jira_project_url` set
- **WHEN** an authenticated user opens the detail view
- **THEN** the Jira Project facet cell shows the label "Jira Project" on the first line and an accent-colored "Open ↗" hyperlink on the second line that opens the URL in a new tab; when the URL is absent the value cell shows `—`

#### Scenario: A status fact is not duplicated
- **GIVEN** a project whose phase is `Build`
- **WHEN** an authenticated user opens the detail view
- **THEN** the phase value appears in a single canonical location (read-only in the header status strip and editable in the settings editor), and is NOT also rendered as a separate standalone stat tile

#### Scenario: Delivery timeline is horizontal and in the header
- **GIVEN** a project with one or more key dates set
- **WHEN** an authenticated user opens the detail view
- **THEN** the delivery timeline renders horizontally within the header, with each milestone marked done/active/upcoming, and there is no separate standalone "Delivery timeline" section

#### Scenario: Actual Go-Live is omitted from the timeline when unset
- **GIVEN** a project with no `actual_go_live` date set
- **WHEN** an authenticated user opens the detail view
- **THEN** the horizontal timeline does NOT include an Actual Go-Live step

#### Scenario: Hypercare end defaults to four weeks after the most relevant go-live
- **GIVEN** a project whose `hypercare_end` is not set and whose `target_go_live` is 2026-09-01 with no `actual_go_live`
- **WHEN** an authenticated user opens the detail view
- **THEN** the Hypercare end step on the timeline displays 2026-09-29 (four weeks after target go-live)

- **GIVEN** the same project but with `actual_go_live` later set to 2026-09-15
- **WHEN** an authenticated user opens the detail view
- **THEN** the Hypercare end step on the timeline displays 2026-10-13 (four weeks after actual go-live)

#### Scenario: Tracker sync footer sits at the bottom of the page
- **GIVEN** a linked project
- **WHEN** a PM opens the detail view
- **THEN** the "Refresh from tracker" button and last-sync subtext appear as a small footer at the bottom of the page, and NOT in the header

#### Scenario: Team allocations panel surfaces the project team
- **GIVEN** a project whose `details.project_manager`, `details.solution_architect`, and `details.solution_consultant` are populated
- **WHEN** an authenticated user views the Team allocations panel
- **THEN** the panel renders a read-only Team roster at the top listing those three people by role and name, above the formal allocation rows

#### Scenario: PM edits a Torii-owned detail field
- **GIVEN** an authenticated PM viewing a project whose `field_mapping."details.primary_contact"` is `torii`
- **WHEN** they edit `Primary Contact` and save
- **THEN** the system persists the new value and it survives the next tracker sync

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

