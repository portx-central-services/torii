## MODIFIED Requirements

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
