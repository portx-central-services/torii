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
The system SHALL render a persistent navigation shell with links to `Projects`, `Capacity`, `Risks`, `Timeline`, and (for admins only) `Trackers`. The shell MUST show the signed-in user's name and a sign-out action.

#### Scenario: Admin sees Trackers link
- **GIVEN** an authenticated user with `PM` role and `is_admin=true`
- **WHEN** any page in the app is rendered
- **THEN** the navigation includes a `Trackers` link

#### Scenario: Non-admin does not see Trackers link
- **GIVEN** an authenticated user with `is_admin=false`
- **WHEN** any page is rendered
- **THEN** the `Trackers` link is not present in the navigation

#### Scenario: Risks and Timeline are visible to all authenticated users
- **GIVEN** any authenticated user (PM or Viewer)
- **WHEN** any page is rendered
- **THEN** the navigation includes both `Risks` and `Timeline` links

### Requirement: Timeline view (Gantt)
The system SHALL provide a timeline view at `/timeline` accessible to any authenticated user. The view MUST render every filtered project as one row in a horizontal time-axis Gantt: time on the X axis, projects on the Y. Each project's bar MUST start at `keyDates.project_start` and end at `keyDates.target_go_live`. When `project_start` is absent, the bar MUST start at the visible window's left edge; when `target_go_live` is absent, the bar MUST end at the visible window's right edge. A project MUST always render — including projects with no scheduled dates at all (e.g., Backlog), which appear as full-width bars signaling "no committed schedule." The bar MUST be colored by the project's **current** `phase` using the seven-phase palette (`Backlog`, `Initiation`, `Design`, `Development`, `UAT`, `GoLiveReadiness`, `Production`).

When the project's real `project_start` exists and falls before the visible window, the bar's left edge MUST render with a dashed border ("clipped-left"); when the real `target_go_live` exists and falls after the visible window, the right edge MUST render with a dashed border ("clipped-right"). A missing date MUST NOT produce a dashed edge.

Each bar MUST surface read-only overlays:

- An **at-risk** indicator (small RAG-colored dot at the bar's left edge) when the project is currently at-risk per the `risk-tracking` capability (most recent `ProjectRiskUpdate` has `ragLevel != Green`).
- An **over-budget** indicator (a small `$` icon at the bar's right edge) when `project.overBudget === true`. The field is derived from the cached Harvest snapshot per the `harvest-integration` capability.

The view MUST provide a **"Show budget" filter-row toggle**, default off. When the toggle is on, each project bar that has a Harvest snapshot with a non-null, non-zero `budget_hours` MUST render a budget-fill overlay:

- A semi-transparent fill layered above the phase color, anchored at the bar's left edge, with width = `min(100, (spent_hours_billable + spent_hours_nonbillable) / budget_hours * 100) %` of the bar's width.
- When `spent_hours > budget_hours`, an additional "overflow" element MUST render from the right edge of the fill to the right edge of the bar, with a diagonal-stripe pattern in a contrasting red tone, signaling the visual overage.

When the toggle is on, projects without a Harvest link or without a `budget_hours` value MUST render their bar normally (no fill, no overflow stripes).

The view MUST default to a 6-month window centered on today (today − 2 months → today + 4 months). Months MUST be labeled along the X axis. A vertical **today line** MUST cross the rows area at the current date when today falls inside the visible window.

The view MUST display a **KPI strip** above the chart showing six counts derived from the currently-filtered projects: total projects in view, distinct people (PM/SA/SC) involved, count in Active stage, count in `UAT`/`GoLiveReadiness`, count in `Development`, and count in `Backlog`/`Initiation`. The strip updates as filters change.

The view MUST expose a **view-mode toggle** between *By project* (one row per project, sorted by start date) and *By person*. In *By person* mode the chart groups visible projects by every distinct person who appears as PM, SA, or SC across the project's `details`, rendering a header row per person followed by one bar row per role assignment. The role MUST be visible as a short badge (`PM`/`SA`/`SC`) on the row label.

The view MUST support the following filters: **date range** (window override; a project is hidden only when its real `project_start` lies strictly after the window OR its real `target_go_live` lies strictly before the window), **project type** (`direct` | `fintech` | `both`, default `both`), **stage** (`Active` | `Committed` | `all`, default `all`), **state** (any subset of `OnTrack` / `AtRisk` / `Blocked` / `Done`), **phase** (any subset of the 7 phase values), **person** (dropdown of all distinct people across PM/SA/SC, or "All people"), and **role** (`PM` | `SA` | `SC` | "any role").

Clicking a bar MUST navigate to the project's detail page.

**Stage derivation**: a project is `Committed` iff `phase === 'Backlog'`; otherwise `Active`.

#### Scenario: Default view renders the portfolio
- **GIVEN** several projects with `project_start` and `target_go_live` set
- **WHEN** an authenticated user opens `/timeline`
- **THEN** the page renders a 6-month window centered on today with one row per project whose date range overlaps the window, and a vertical today line at the current date

#### Scenario: Project with no schedule still renders as a full-width bar
- **GIVEN** a Backlog project with no `project_start` and no `target_go_live`
- **WHEN** an authenticated user opens `/timeline`
- **THEN** the project's bar spans the entire visible window with no dashed edges, colored by its current phase (e.g., slate for Backlog)

#### Scenario: Real project_start before the window draws a clipped-left edge
- **GIVEN** a project whose `project_start = 2024-01-01` and the visible window starts at `2025-10-01`
- **WHEN** the timeline renders the project's bar
- **THEN** the bar's left edge sits at the window's left edge with a dashed-left border signaling "extends beyond"

#### Scenario: Real target_go_live after the window draws a clipped-right edge
- **GIVEN** a project whose `target_go_live = 2030-01-01` and the visible window ends at `2026-10-01`
- **WHEN** the timeline renders the project's bar
- **THEN** the bar's right edge sits at the window's right edge with a dashed-right border signaling "extends beyond"

#### Scenario: Missing endpoint produces no dashed edge
- **GIVEN** a project with `project_start = 2026-02-10` and no `target_go_live`
- **WHEN** the timeline renders the project's bar
- **THEN** the bar starts at the project_start date (clean left edge — date is inside the window) and ends at the window's right edge with NO dashed-right border (absence is not "extends beyond")

#### Scenario: Project entirely after the window is hidden
- **GIVEN** a project whose `project_start = 2030-06-01` (after the visible window's right edge)
- **WHEN** the timeline renders
- **THEN** that project does NOT appear in the list

#### Scenario: Project entirely before the window is hidden
- **GIVEN** a project whose `target_go_live = 2020-01-01` (before the visible window's left edge)
- **WHEN** the timeline renders
- **THEN** that project does NOT appear in the list

#### Scenario: Today line is rendered inside the visible window
- **GIVEN** the visible window includes today's date
- **WHEN** the timeline renders
- **THEN** a vertical accent-colored line spans the rows area at today's horizontal position, labeled "TODAY"

#### Scenario: KPI strip reflects the currently-filtered projects
- **GIVEN** the user applies a `phase=Development` filter
- **WHEN** the timeline renders
- **THEN** the "In Development" KPI equals the visible project count, and the other KPIs are recomputed against the same filtered set

#### Scenario: Stage = Committed filter shows only Backlog projects
- **GIVEN** the user sets `stage=Committed`
- **WHEN** the timeline renders
- **THEN** every visible project has `phase === 'Backlog'` (the deriveStage heuristic)

#### Scenario: Person + role filter requires both to match
- **GIVEN** the user selects `person=Aaron Levy` and `role=PM`
- **WHEN** the timeline renders
- **THEN** only projects whose `details.project_manager === 'Aaron Levy'` appear (Aaron's SA/SC assignments are excluded)

#### Scenario: Person-only filter matches any role
- **GIVEN** the user selects `person=Vitor Barros` with `role=Any role`
- **WHEN** the timeline renders
- **THEN** projects where Vitor is PM OR SA OR SC all appear

#### Scenario: By-person view groups each role assignment under its person
- **GIVEN** a project with PM `Aaron`, SA `Vitor`, SC `Halan`, and the user selects "By person"
- **WHEN** the timeline renders
- **THEN** that project appears three times — once in Aaron's group with a `PM` badge, once in Vitor's with a `SA` badge, once in Halan's with a `SC` badge

#### Scenario: By-person view sorts groups alphabetically by person and bars by start date
- **GIVEN** several people in the visible set
- **WHEN** the timeline switches to "By person"
- **THEN** person groups are sorted alphabetically; within each group, rows are sorted by bar start date

#### Scenario: At-risk bar shows a RAG dot
- **GIVEN** a project currently at-risk per `risk-tracking` with `ragLevel = Amber`
- **WHEN** the timeline renders the project's bar
- **THEN** an Amber-colored dot is rendered at the bar's left edge

#### Scenario: Over-budget overlay activates on Harvest-flagged projects
- **GIVEN** a project linked to Harvest with a snapshot where `spent_hours > budget_hours` (so `overBudget === true`)
- **WHEN** the timeline renders the project's bar
- **THEN** the `$` over-budget icon is rendered at the bar's right edge

#### Scenario: Show-budget toggle renders a budget fill on linked projects
- **GIVEN** a project linked to Harvest with snapshot `spent_hours = 400`, `budget_hours = 800`, and the user toggles "Show budget" on
- **WHEN** the timeline renders the project's bar
- **THEN** a semi-transparent budget-fill overlay renders at the left edge of the bar with width = 50% of the bar's width

#### Scenario: Show-budget toggle renders striped overflow when over budget
- **GIVEN** the Abrigo example: `spent_hours = 838.50`, `budget_hours = 615` (36% over), and "Show budget" is on
- **WHEN** the timeline renders the project's bar
- **THEN** the budget-fill overlay extends to 100% of the bar width AND a diagonal-stripe overflow element renders from the fill's right edge to the bar's right edge in a contrasting red

#### Scenario: Show-budget toggle is a no-op for unlinked projects
- **GIVEN** a project with no Harvest link and "Show budget" is on
- **WHEN** the timeline renders the project's bar
- **THEN** the bar renders normally with no budget fill and no overflow stripes (phase color only)

#### Scenario: Show-budget toggle is a no-op when budget_hours is null/0
- **GIVEN** a project linked to Harvest whose snapshot has `budget_hours = NULL` and "Show budget" is on
- **WHEN** the timeline renders the project's bar
- **THEN** the bar renders normally with no budget fill

#### Scenario: Filter by project type
- **GIVEN** projects of mixed type and `?projectType=fintech` selected
- **WHEN** the timeline renders
- **THEN** only projects whose derived `projectType` equals `fintech` (i.e., `details.fintech_parent` is set) appear

#### Scenario: Filter by person matches owner or any team role
- **GIVEN** a project whose `details.solution_architect = "Dana Lee"` and a person filter of `dana`
- **WHEN** the timeline renders
- **THEN** that project is included

#### Scenario: Click navigates to detail
- **WHEN** the user clicks a project bar
- **THEN** the browser navigates to `/projects/{id}` for that project

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

### Requirement: Project detail page
The project detail page (`/projects/:id`) SHALL display project metadata, key dates, tracker links, an optional Monday tracker panel, and — when the project is linked to a Harvest project — a Harvest panel. The header band MUST display the project name, the phase badge, the state badge, and — when a Harvest snapshot exists — a budget chip ("On budget" green / "Over budget −N%" red) next to the state badge.

The Harvest panel is detailed in the `harvest-integration` capability; this requirement only pins WHERE it renders (below the existing Monday details panel on the detail page) and the budget chip's positioning (next to the existing State badge in the header band).

#### Scenario: Linked project shows the budget chip
- **GIVEN** a project linked to Harvest with a fresh snapshot showing `overBudget = true`, spent 838.50h, budget 615h
- **WHEN** any authenticated user opens the project detail page
- **THEN** the header band includes an "Over budget −36%" chip in red, rendered immediately after the State badge

#### Scenario: Unlinked project hides the budget chip
- **GIVEN** a project with no Harvest link
- **WHEN** any user opens the project detail page
- **THEN** no budget chip is rendered next to the State badge

#### Scenario: Linked-but-not-yet-refreshed project hides the chip
- **GIVEN** a project that is linked to Harvest but has never been refreshed (no snapshot row)
- **WHEN** a user opens the project detail page
- **THEN** no budget chip is rendered (an "On budget" claim would be misleading with no data)

