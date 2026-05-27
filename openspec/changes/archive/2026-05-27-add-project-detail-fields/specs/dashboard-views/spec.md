## MODIFIED Requirements

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
The system SHALL provide a detail view at `/projects/{id}` that renders the project's name, phase, state, owner, all four key dates, all eleven `details` fields (with `status_report_url` and `jira_project_url` rendered as clickable anchors when set), the tracker badge with last-sync timestamp (if linked), an editable phase/state control (PM role only), an editable key-dates panel (PM role only), an editable details panel for `torii`-owned detail fields (PM role only), a "Refresh from tracker" button (visible only when linked), and the project's current allocations.

#### Scenario: PM edits phase from detail view
- **GIVEN** an authenticated PM viewing a project in phase `Build`
- **WHEN** they change the phase control to `UAT` and confirm
- **THEN** the system persists the change, refreshes the panel, and the audit log records the transition

#### Scenario: Viewer cannot see edit controls
- **GIVEN** an authenticated user with role `Viewer`
- **WHEN** they open the detail view
- **THEN** edit controls and the "Refresh from tracker" button are not rendered

#### Scenario: Detail view renders the eleven fields
- **GIVEN** a project with several `details` fields populated
- **WHEN** an authenticated user opens the detail view
- **THEN** the page shows each populated detail field, with link fields rendered as clickable anchors

#### Scenario: PM edits a Torii-owned detail field
- **GIVEN** an authenticated PM viewing a project whose `field_mapping."details.primary_contact"` is `torii`
- **WHEN** they edit `Primary Contact` and save
- **THEN** the system persists the new value and it survives the next tracker sync
