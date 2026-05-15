## ADDED Requirements

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
