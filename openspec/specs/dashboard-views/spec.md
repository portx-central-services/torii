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
The system SHALL render a persistent navigation shell with the order **Dashboard → Timeline → Risks → Customers → Projects → People → Capacity → Insights → Trackers**. The shell MUST show the signed-in user's name and a sign-out action. The `Trackers` AND `Insights` links MUST be visible only to users with role `PM` or `isAdmin === true`.

The header band (Torii logo + nav links) MUST be sticky to the top of the viewport so it remains visible while the main content scrolls. The signed-in user footer MUST be sticky to the bottom of the viewport so it remains visible regardless of page length. The main content scroll region sits between the two sticky bands. Both bands MUST have a solid background so scrolling content does not bleed through.

#### Scenario: Nav order
- **GIVEN** any authenticated user opens any page
- **WHEN** the nav shell renders
- **THEN** the visible links appear in the order Dashboard, Timeline, Risks, Customers, Projects, People, Capacity (plus Insights and Trackers when the user has the PM role or is an admin)

#### Scenario: Dashboard is the default landing
- **GIVEN** an authenticated user opens `/`
- **WHEN** the route resolves
- **THEN** the Portfolio Dashboard page renders

#### Scenario: Insights is hidden from Viewers
- **GIVEN** an authenticated user with role `Viewer` (`is_admin = false`)
- **WHEN** any page is rendered
- **THEN** the navigation does NOT include the `Insights` link

#### Scenario: Insights is visible to PMs
- **GIVEN** an authenticated user with role `PM`
- **WHEN** any page is rendered
- **THEN** the navigation includes the `Insights` link (positioned between `Capacity` and `Trackers`)

#### Scenario: Insights is visible to admins (even when role is Viewer)
- **GIVEN** an authenticated user with `is_admin = true` and role `Viewer`
- **WHEN** any page is rendered
- **THEN** the navigation includes the `Insights` link

#### Scenario: Customers and People are visible to non-admin users
- **GIVEN** any authenticated user
- **WHEN** any page is rendered
- **THEN** the navigation includes the `Customers` and `People` links

#### Scenario: Header sticky on long pages
- **GIVEN** a user on `/projects` with rows that overflow the viewport
- **WHEN** the user scrolls the page
- **THEN** the header band remains visible at the top of the viewport at every scroll position

#### Scenario: User footer sticky on long pages
- **GIVEN** the same scrolled page
- **WHEN** the user scrolls toward the bottom
- **THEN** the signed-in user band remains visible at the bottom of the viewport at every scroll position

#### Scenario: Admin sees Trackers link
- **GIVEN** an authenticated user with `is_admin = true`
- **WHEN** any page is rendered
- **THEN** the navigation includes a `Trackers` link

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

### Requirement: Per-person view at `/people/:id`
The system SHALL provide a per-person detail view at `/people/:id` accessible to any authenticated user. The view MUST display:

- A header band with the person's name, email, role badge (`PM` or `Viewer`), and an admin badge when `isAdmin === true`.
- A **Workload** section (described below) showing the person's currently-active projects, their self-reported weekly capacity per project, their availability for new commitments, and the existing per-person reconciliation data joined in.
- Four role sections — **Owner**, **Project Manager**, **Solution Architect**, **Senior Consultant** — each listing every project where this person currently holds that role. The same project MAY appear in multiple sections when the person holds more than one role on it.
- Each role-section project row displays: project name (link to `/projects/:id`), current phase badge, current state badge, and the over-budget chip when `project.overBudget === true`.
- Each role section that has no projects MUST render an empty-state line ("No projects as Project Manager" etc.).

Project membership for the role sections is derived from `Project.ownerId`, `project_manager_id`, `solution_architect_id`, and `solution_consultant_id`. The role sections are read-only.

**Workload section (new):**

The Workload section sits between the header band and the role sections. It reads from `GET /api/people/:id/workload` and renders:

1. **Availability row** — labeled "Availability for more work", showing the person's `availabilityPct`. When the viewer matches the editable condition (see below), the value is an inline numeric input (0–100, step 5); otherwise it's a static `N%` display.
2. **Project workload table** — one row per project in the union of (active allocation) ∪ (non-zero self-reported capacity). Columns:
   - Project name (link to `/projects/:id`) + phase badge.
   - **Current weekly capacity** — the self-reported `weeklyPct`. Inline numeric editor (0–100) when editable; static display otherwise.
   - **Planned: N%** — `allocatedPct` from active allocations, muted gray. Read-only at all times (it's PM-owned).
   - **Lifetime hours** — from the reconciliation join. Displayed as `—` when the person is not Harvest-linked.
   - **Variance chip** — green/amber/red/neutral, computed from planned vs. lifetime hours (reusing the existing `varianceBucket` helper).
   - **Remove** button (editable only) — removes the row by PATCHing `weeklyPct: 0` for that project.
3. **Add project** affordance (editable only) — a dropdown of non-Done projects not already in the table. Selecting one creates a capacity row at `weeklyPct: 5` so the row appears immediately for further editing.
4. **Advisory sum line** (always shown) — `Σ reported: X% · availability: Y% · unaccounted: Z%`, where `Z = max(0, defaultCapacityPct - X - Y)`. When `X + Y > defaultCapacityPct`, the line goes amber and reads `over-committed by N%` instead of `unaccounted`. The advisory is purely visual; no mutation is blocked.

**Editable condition:** the section's inline editors, Remove buttons, and Add-project dropdown render ONLY when `viewer.id === person.id` OR `viewer.isAdmin === true`. Other authenticated viewers see the same data read-only.

#### Scenario: Person holds multiple roles
- **GIVEN** a person who is PM on three projects, SA on two, and owner of one (with overlap)
- **WHEN** they open `/people/:id`
- **THEN** the page shows their projects in the appropriate role sections; a project where they are both PM and Owner appears in both

#### Scenario: Empty role sections
- **GIVEN** a person who is only a PM (no SA or SC roles, no owned projects)
- **WHEN** they open `/people/:id`
- **THEN** the PM section lists their projects; the Owner, SA, and SC sections each show "No projects as <role>."

#### Scenario: Project state surfaces over-budget
- **GIVEN** a person's project list includes a project with `overBudget === true`
- **WHEN** the page renders
- **THEN** that project's row carries the "Over budget" chip

#### Scenario: Self viewing own page sees editable Workload
- **GIVEN** authenticated user Aaron viewing `/people/Aaron`
- **WHEN** the page renders
- **THEN** the Workload section's availability and per-project capacity values are inline editors and an Add-project affordance is visible

#### Scenario: Non-admin viewing another user sees read-only Workload
- **GIVEN** authenticated user Drew (non-admin) viewing `/people/Aaron`
- **WHEN** the page renders
- **THEN** the Workload section shows the same values but with no input controls, no Remove buttons, and no Add-project affordance

#### Scenario: Admin viewing another user sees editable Workload
- **GIVEN** authenticated admin Drew viewing `/people/Aaron`
- **WHEN** the page renders
- **THEN** the Workload section renders with full edit affordances (same as self)

#### Scenario: Advisory line flips to amber on over-commit
- **GIVEN** a person with `defaultCapacityPct = 100`, `availabilityPct = 20`, and capacity rows summing to 90%
- **WHEN** the Workload section renders
- **THEN** the advisory line reads `over-committed by 10%` in amber

#### Scenario: Project in workload by self-report only (no active allocation)
- **GIVEN** a person with a capacity row of `weeklyPct = 30` on project P AND no active allocation on P
- **WHEN** the page renders
- **THEN** the row for P shows `Current: 30%`, `Planned: —`, and the variance chip is `neutral` (no planned baseline to compare against)

#### Scenario: Project in workload by active allocation only (no self-report)
- **GIVEN** a person with an active 50% allocation on project P AND no capacity row on P
- **WHEN** the page renders
- **THEN** the row for P shows `Current: 0%`, `Planned: 50%`, and the variance chip reflects 50% vs. lifetime hours

### Requirement: Timeline person filter is driven by Person FKs, not substring matching
The Timeline view's person filter SHALL be a dropdown of Person rows (populated from `GET /api/people`). When a person is selected, the visibility filter MUST compare Person IDs against each project's `ownerId`, `project_manager_id`, `solution_architect_id`, and `solution_consultant_id` — not against substring matches on the legacy `details.*` strings.

The "any role" / role-specific selector behavior from the prior change is preserved: when both person and role are set, the project must hold that specific FK; with person only, any of the four FKs must match; with role only, any project where that FK is non-null qualifies.

#### Scenario: Person dropdown is populated from /api/people
- **GIVEN** the system has 12 Person rows
- **WHEN** the user opens the Timeline page
- **THEN** the Person filter dropdown lists those 12 Person rows by name (plus "All people")

#### Scenario: Filter matches by ID, not substring
- **GIVEN** two Person rows named "Aaron Levy" and "Aaron Levenson" exist as separate FK targets
- **WHEN** the user selects "Aaron Levy" in the dropdown
- **THEN** only projects where `project_manager_id` (etc.) equals Aaron Levy's id are visible; projects whose FK points at Aaron Levenson do NOT appear

#### Scenario: By-person view groups by Person, falling back to string
- **GIVEN** a project with `project_manager_id` set (Person row) and `solution_consultant_id` null but `details.solution_consultant = "Sarah Unresolved"`
- **WHEN** the user switches to By-person view
- **THEN** the project appears in Aaron Levy's group (PM) and ALSO in a "Sarah Unresolved" string-fallback group (SC); the string-fallback group is visually identical to a Person group but has no link to a `/people/:id` page

### Requirement: Project detail + projects list render Person.name with link when FK is set
The three role rows on the project detail page and the three role columns on the projects list SHALL display the resolved Person's name as a link to `/people/:id` when the FK is set, falling back to the legacy `details.*` string (plain text, no link) when the FK is null.

The Projects-page search input (from the prior change) MUST include the resolved Person names in its search haystack, so typing a person's name surfaces every project they hold any role on — independent of whether the legacy `details.*` string is stale.

#### Scenario: Role row links to /people/:id
- **GIVEN** a project whose `projectManager` Person is "Aaron Levy" with id `aaron-id`
- **WHEN** the project detail page renders
- **THEN** the PM row shows "Aaron Levy" rendered as `<a href="/people/aaron-id">`

#### Scenario: Search finds projects by Person.name even when the legacy string is different
- **GIVEN** a project whose `details.project_manager = "Aaron J. Levy"` but the resolved Person's name is "Aaron Levy"
- **WHEN** the user types "aaron levy" on the Projects page search
- **THEN** that project is included in the results

### Requirement: Projects page free-text search
The Projects page SHALL provide a search input that filters the project list client-side. The match MUST be a case-insensitive substring tested against a per-project haystack of: project name, current state, current phase display label, owner identifier, and every team-and-context detail field (`project_manager`, `solution_architect`, `solution_consultant`, `core_solution`, `core_vendor`, `customer_type`, `customer_status`, `finance_use_case`, `use_case_group`, `primary_contact`).

The search composes with the existing filter dropdowns AND with the new tile filter via AND — projects must satisfy every active filter to render. The filtered count MUST update live as the user types.

#### Scenario: Search filters by project name
- **GIVEN** a project named "Acme integration"
- **WHEN** the user types `acm` in the search input
- **THEN** the project remains visible; unrelated projects are hidden

#### Scenario: Search matches a person across roles
- **GIVEN** a project whose `details.solution_consultant = "Dana Lee"`
- **WHEN** the user types `dana` in the search
- **THEN** that project is included

#### Scenario: Search matches the core vendor
- **GIVEN** a project whose `details.core_vendor = "Jack Henry"`
- **WHEN** the user types `henry`
- **THEN** that project is included

#### Scenario: Search composes with the existing phase filter
- **GIVEN** the user has selected `phase=UAT` in the existing dropdown and types `acm` in search
- **WHEN** the list renders
- **THEN** only UAT-phase projects matching "acm" appear

### Requirement: Projects page KPI tiles act as filter links
The KPI tiles at the top of the Projects page SHALL be interactive single-selected filters. Each tile is a button; clicking it sets the page's tile filter; clicking the currently active tile clears the filter. The tile filter composes with the search input and the dropdown filters via AND. The active tile MUST be visually distinguished (border accent or background tint).

The tile filters MUST be:

- **Active**: `state in (OnTrack, AtRisk, Blocked)` AND `phase != Backlog`.
- **On track**: `state === OnTrack`.
- **At Risk**: `state === AtRisk`.
- **Blocked**: `state === Blocked`.
- **Go-Live ≤ 60d**: `keyDates.target_go_live` is set AND falls within 60 days of today AND `state != Done`.
- **Total**: clears the tile filter (the existing tile remains as a "clear" affordance).

Filters cannot be combined across tiles — selecting one deselects the previously active tile.

#### Scenario: Clicking At Risk narrows the list
- **GIVEN** a mix of projects in OnTrack, AtRisk, Blocked, and Done states
- **WHEN** the user clicks the "At Risk" tile
- **THEN** only `state === AtRisk` projects render and the tile is visually active

#### Scenario: Clicking the active tile clears it
- **GIVEN** the "At Risk" tile is active
- **WHEN** the user clicks "At Risk" again
- **THEN** the filter clears and every project renders again

#### Scenario: Go-Live ≤ 60d excludes Done projects
- **GIVEN** a Done project whose `target_go_live` is 14 days ago and an active project whose `target_go_live` is 30 days from today
- **WHEN** the user clicks "Go-Live ≤ 60d"
- **THEN** the active project renders; the Done project does not

#### Scenario: Active tile composes with search via AND
- **GIVEN** the user has clicked the "Active" tile and typed "acme" in search
- **WHEN** the list renders
- **THEN** only projects matching both filters render (non-Backlog non-Done projects whose haystack contains "acme")

### Requirement: Per-project Allocations vs. Actuals panel
The project detail page SHALL render a `<ReconciliationPanel>` section card below the existing AllocationsPanel. The panel is visible to every authenticated user (read-only — no edit affordances).

The panel MUST render a table with one row per Person allocated to this project (via the existing `allocations` table). Each row displays:

- **Person name** (linked to `/people/:id` when the FK resolves; falls back to allocation's `personId` otherwise)
- **Planned hours** — the sum of `plannedHoursForAllocation` across every allocation this Person has on this project
- **Actual hours** — total from the project's Harvest snapshot breakdown, summing all `tasks[].people[]` entries where `people[i].personId === person.harvest_user_id`. Renders "no Harvest link" when the Person has no `harvest_user_id` set.
- **Variance** — signed hours and signed percentage; null when actuals are null
- **Status chip** — green/amber/red per `varianceBucket(planned, actual)`; neutral "no Harvest link" chip when actuals are null

Below the main table, a collapsible `<details>` titled "Logged but not allocated" MUST list every Person from the Harvest snapshot breakdown whose `harvest_user_id` doesn't match any allocated Person on this project. This surfaces the inverse error case — work logged without a corresponding allocation. Each "Logged but not allocated" row shows the Person's name (linked when resolvable) and their actual hours.

When the project has no allocations, the panel renders "No allocations on this project." When the project has no Harvest snapshot, the panel renders "No Harvest snapshot — refresh the project to populate actuals." When the project has allocations but no allocated Person is linked to a Harvest user, the panel renders the planned-hours column with "no Harvest link" chips and a one-line CTA "Link Torii People to Harvest users at /trackers".

#### Scenario: All allocated people are linked
- **GIVEN** a project with 3 allocations whose People all have `harvest_user_id` set, and a Harvest snapshot
- **WHEN** the page renders
- **THEN** the panel shows 3 rows with planned and actual hours; variance chips reflect the buckets

#### Scenario: One person unlinked
- **GIVEN** the same project but one allocated Person has no `harvest_user_id`
- **WHEN** the page renders
- **THEN** that person's row shows the planned hours and a "no Harvest link" neutral chip in place of actuals; the other two rows render normally

#### Scenario: Logged-but-not-allocated surfaces invisible work
- **GIVEN** the Harvest snapshot includes a developer's hours, and that developer has a linked Torii Person, but is NOT in the project's `allocations`
- **WHEN** the page renders
- **THEN** the developer appears in the "Logged but not allocated" disclosure with their actual hours

#### Scenario: No allocations
- **GIVEN** a project with zero `allocations` rows
- **WHEN** the page renders
- **THEN** the panel renders "No allocations on this project."

#### Scenario: No Harvest snapshot
- **GIVEN** a project with allocations but no `project_harvest_snapshots` row (not yet refreshed, or no Harvest link)
- **WHEN** the page renders
- **THEN** the panel renders "No Harvest snapshot — refresh the project to populate actuals." with a link affordance to the HarvestPanel's refresh button

### Requirement: Per-person Allocations vs. Actuals section on /people/:id
The `/people/:id` view SHALL render an "Allocations vs. Actuals" section below the existing role sections. The section is hidden entirely when the Person has no allocations AND no `harvest_user_id` (nothing to show).

The section MUST fetch `GET /api/people/:id/reconciliation` and render a table: Project name (link) | Planned | Actual | Variance | Status chip. Same color-coded variance chip rules as the per-project panel. The "no Harvest link" state renders when the Person's `harvest_user_id` is null; the table still shows planned hours per project, just without actuals or variance.

#### Scenario: Linked person with allocations on 3 projects
- **GIVEN** a Person linked to a Harvest user, with allocations on 3 projects
- **WHEN** they open `/people/:id`
- **THEN** the Allocations vs. Actuals section shows 3 rows with planned + actual + variance

#### Scenario: Unlinked person
- **GIVEN** a Person with allocations on projects but no `harvest_user_id`
- **WHEN** the page renders
- **THEN** every row shows planned hours; the Actual / Variance columns show null; the status chip is "no Harvest link" neutral

#### Scenario: Person with no allocations and no Harvest link
- **GIVEN** a Person with neither allocations nor a Harvest user link
- **WHEN** the page renders
- **THEN** the Allocations vs. Actuals section is hidden entirely (not rendered at all, no empty card)

### Requirement: Portfolio Dashboard page at `/`
The system SHALL provide a Portfolio Dashboard at the root path `/` accessible to every authenticated user. The page is read-only — no edit affordances. Every numeric value on the page that represents a project or person count MUST be a clickable link that navigates to the drill-down view containing those projects/people.

The page MUST contain the following sections in order:

1. **Hero KPI band** — 6 clickable tiles, in this order:
   - **Active**: count of projects whose `state` is not `Done`. Click → `/projects`.
   - **At risk**: count of distinct projects whose most-recent `ProjectRiskUpdate` has `ragLevel != Green` AND `state != Done`. Click → `/risks`.
   - **Over budget**: count of projects where `overBudget === true`. Click → `/projects`.
   - **Launching ≤ 30d**: count of projects with `keyDates.target_go_live` set, within 30 days of today, and `state != Done`. Click → `/projects`.
   - **Avg slip**: average `(actual_go_live − baseline_go_live)` in days across Done projects with both dates set. Click → `/projects`.
   - **People involved**: count of distinct Person rows appearing as PM/SA/SC on any non-Done project. Non-interactive (no link until a `/people` index page exists).

2. **This week's risk picture** — Red / Amber / Green chips with the count of distinct projects whose most-recent weekly RAG is at that level. Each chip MUST show the previous-week's count as muted subtext. Red and Amber chips MUST link to `/risks`; the Green chip MUST NOT be clickable.

3. **Schedule pressure** — a list of every project with `keyDates.target_go_live` set within 30 days of today AND `state != Done`. Sorted ascending by date. Each row MUST show: project name (link to `/projects/:id`), the date, days-until-target, phase badge, RAG chip (when an at-risk update exists), and over-budget chip (when `overBudget`). Empty state when nothing is launching in the window.

4. **Needs attention** — two side-by-side cards:
   - **No risk update this week**: active projects (`state != Done`) with no `ProjectRiskUpdate` row for the current ISO week. Each row: project name (link), latest RAG (any week, or "no prior update"), weeks-since-last-update. Sort: worst latest RAG first, then weeks-since-last-update descending.
   - **Slipping**: projects where `target_go_live > baseline_go_live` AND `state != Done`. Each row: project name (link), baseline date, current target date, slip days (in red). Sorted by slip-days descending. Limited to 30 rows.

5. **Phase distribution** — a horizontal stacked bar with one segment per `Phase` value, segment widths proportional to the count of active projects in that phase. Uses the seven-phase color palette established by the Timeline page. Hovering a segment MUST show a tooltip with the phase label and the count.

#### Scenario: Default landing is the dashboard
- **GIVEN** an authenticated user opens `/`
- **WHEN** the page resolves
- **THEN** the Portfolio Dashboard renders (it is no longer a redirect to `/projects`)

#### Scenario: Hero KPI tile links to its drill-down
- **GIVEN** the user is on the dashboard
- **WHEN** they click the "At risk" tile
- **THEN** the browser navigates to `/risks`

#### Scenario: Green RAG chip is not clickable
- **GIVEN** the dashboard is rendered
- **WHEN** the user clicks the Green-week chip
- **THEN** no navigation occurs (the chip has no link target)

#### Scenario: Schedule pressure surfaces launching projects in order
- **GIVEN** three projects with `target_go_live` of `today+5d`, `today+15d`, and `today+25d` (all non-Done)
- **WHEN** the dashboard renders
- **THEN** the schedule-pressure list shows all three rows ordered ascending by date

#### Scenario: Schedule pressure excludes far-future projects
- **GIVEN** a project with `target_go_live` 60 days from today
- **WHEN** the dashboard renders
- **THEN** that project is NOT in the schedule-pressure list

#### Scenario: No-risk-update list surfaces active projects without a current-week update
- **GIVEN** project A has a `ProjectRiskUpdate` for the current ISO week; project B does not (and is not Done)
- **WHEN** the dashboard renders
- **THEN** project B appears in the "No risk update this week" card; project A does not

#### Scenario: Slipping list shows positive slip only
- **GIVEN** project A with `baseline_go_live = 2026-08-01` and `target_go_live = 2026-09-15` (slipped); project B with `target_go_live = 2026-07-15` (pulled in)
- **WHEN** the dashboard renders
- **THEN** project A appears in the slipping list; project B does not

#### Scenario: Avg-slip KPI uses Done projects only
- **GIVEN** several Done projects with both `baseline_go_live` and `actual_go_live` set, and other in-flight projects with `baseline_go_live` and `target_go_live` set
- **WHEN** the dashboard's "Avg slip" KPI is computed
- **THEN** only the Done projects contribute; in-flight projects are excluded (they're reflected in the "Slipping" list instead)

#### Scenario: Phase distribution renders all seven segments
- **GIVEN** active projects span every phase except `Production`
- **WHEN** the phase-distribution bar renders
- **THEN** six segments render with widths proportional to their counts; the `Production` segment is zero-width (or hidden) and does not break the bar

### Requirement: `GET /api/dashboard/summary` aggregation endpoint
The system SHALL expose `GET /api/dashboard/summary` returning the data required by the Portfolio Dashboard in a single response. Accessible to any authenticated user. The response shape MUST be:

```ts
{
  kpis: {
    active: number;
    atRisk: number;
    overBudget: number;
    launchingSoon: number;
    avgSlipDays: number | null;  // null when no Done projects have both dates set
    peopleInvolved: number;
  };
  thisWeekRag: {
    red: number; amber: number; green: number;
    prevRed: number; prevAmber: number; prevGreen: number;
  };
  schedulePressure: Array<{
    projectId: string;
    projectName: string;
    targetGoLive: string;       // ISO yyyy-mm-dd
    daysUntil: number;
    phase: Phase;
    ragLevel: RagLevel | null;  // most-recent non-Green latest week, or null
    overBudget: boolean;
  }>;
  noRiskUpdate: Array<{
    projectId: string;
    projectName: string;
    latestRagLevel: RagLevel | null;
    weeksSinceLastUpdate: number | null;
  }>;
  slipping: Array<{
    projectId: string;
    projectName: string;
    baselineGoLive: string;     // ISO yyyy-mm-dd
    targetGoLive: string;       // ISO yyyy-mm-dd
    slipDays: number;           // positive integer
  }>;
  phaseCounts: Record<Phase, number>;
}
```

The endpoint MUST NOT require any query parameters. All sub-queries MUST scope appropriately: `active` means `state != Done` everywhere; risk counts use the same `DISTINCT ON (project_id) ORDER BY week_of DESC` shape `/api/risks` uses.

#### Scenario: Endpoint returns the full summary in one call
- **WHEN** an authenticated user reads `GET /api/dashboard/summary`
- **THEN** the response is a single JSON object containing every top-level key above; no key is missing

#### Scenario: `avgSlipDays` is null when no Done project has both dates
- **GIVEN** zero Done projects have both `baseline_go_live` AND `actual_go_live` set
- **WHEN** the endpoint is called
- **THEN** `kpis.avgSlipDays` is `null`

#### Scenario: `phaseCounts` includes zero buckets
- **GIVEN** no active projects are in `Production` phase
- **WHEN** the endpoint is called
- **THEN** `phaseCounts.Production` is `0` (the key is present, the value is zero)

#### Scenario: Unauthenticated request is rejected
- **WHEN** an unauthenticated client reads the endpoint
- **THEN** the response is 401

### Requirement: Customers index at `/customers`
The system SHALL provide a customers index at `/customers` accessible to every authenticated user. The page renders a sortable table with one row per `Customer`. Columns: name (link to `/customers/:id`), # Monday projects (`COUNT(projects WHERE customer_id = c.id)`), # Harvest projects (`COUNT(harvest_projects WHERE customer_id = c.id)`), lifetime hours (`SUM(harvest_projects.spent_billable + spent_nonbillable) WHERE customer_id = c.id`), and a "Linked to Harvest" badge (true when `harvest_client_id IS NOT NULL`).

The table MUST support client-side sorting on every column. The default sort is by name ascending. Empty values (e.g., zero Harvest projects) sort last when sorting by that column.

#### Scenario: Customer with no Harvest linkage renders
- **GIVEN** a Customer with `harvest_client_id = NULL` and two Monday projects
- **WHEN** an authenticated user opens `/customers`
- **THEN** the row shows # Monday projects = 2, # Harvest projects = 0, lifetime hours = 0, and the "Linked to Harvest" badge is absent

#### Scenario: Sort by lifetime hours
- **GIVEN** three customers with lifetime hours 100, 0, 500
- **WHEN** the user clicks "Lifetime hours" header to sort descending
- **THEN** rows appear in order 500, 100, 0

### Requirement: Customer detail at `/customers/:id`
The system SHALL provide a customer detail page at `/customers/:id` accessible to every authenticated user. The page MUST contain the following sections in order:

1. **Header card** — Customer name (large), "Linked to Harvest" badge with the Harvest client name when set, "Edit name" button (PM or admin only).
2. **Monday projects** — Table of every project with `customer_id = :id`. Columns: name (link to `/projects/:id`), phase badge, state badge, target go-live, RAG chip when an at-risk update exists. Empty state: "No Monday projects under this customer yet."
3. **Harvest projects** — Table of every `harvest_projects` row with `customer_id = :id`. Columns: name (link to `harvest_project_url`), is-billable badge, "Pinned to" (link to the Torii project when set, "—" when customer-only), budget hours, spent hours, percent-of-budget chip, last-fetched. Empty state: "No Harvest projects under this customer yet."
4. **Customer-wide reconciliation** — Card showing the response of `GET /api/customers/:id/reconciliation`. Top row: planned hours, actual hours, support hours, variance chip (signed % using the existing green/amber/red bucket helper). Below: a small table of `perProject` rows (project name → planned, actual, variance chip).

#### Scenario: Customer with mixed delivery and support
- **GIVEN** customer C with two Monday projects and three Harvest projects (two pinned, one support)
- **WHEN** any authenticated user opens `/customers/C`
- **THEN** the Monday projects section lists two rows, the Harvest projects section lists three rows (the support row shows "—" in the Pinned-to column), and the reconciliation card shows non-zero `supportHours`

#### Scenario: Edit name is gated to PM / admin
- **GIVEN** customer C and a Viewer user
- **WHEN** the Viewer opens `/customers/C`
- **THEN** the "Edit name" button is not rendered

#### Scenario: Empty state
- **GIVEN** a customer with no Monday projects yet
- **WHEN** the page renders
- **THEN** the Monday projects section shows the empty-state message and the reconciliation card shows planned hours = 0 with variance "—"

### Requirement: Project detail surfaces the customer link
The system SHALL render the customer name as a clickable link on `/projects/:id` when `customerId` is set. The link MUST appear in the header facets band alongside the existing Team and Links facets. When `customerId` is NULL, the facet renders the em-dash "—" with no link target.

#### Scenario: Project with customer linked
- **GIVEN** a project with `customerId` set to customer C ("Acme Corp")
- **WHEN** the project detail page renders
- **THEN** the header facets band shows "Customer: Acme Corp" as a link to `/customers/C`

#### Scenario: Project without customer linked
- **GIVEN** a project with `customerId = NULL`
- **WHEN** the page renders
- **THEN** the facets band shows "Customer: —" with no link

### Requirement: People index at `/people`
The system SHALL provide a People index at `/people` accessible to every authenticated user. The page renders a sortable table with one row per `Person`. Columns, in order:

1. **Name** — link to `/people/:id`.
2. **Role** — `PM` or `Viewer` chip, with an `Admin` star when `isAdmin === true`. Includes a muted `Harvest` badge when `harvestUserId === null` to flag people who aren't linked to Harvest yet.
3. **Capacity** — `<committedPct>% committed of <defaultCapacityPct>%`. When `committedPct + availabilityPct > defaultCapacityPct`, an amber "Over by N%" chip renders alongside the cell.
4. **Available** — the person's `availabilityPct` rendered as `N%`.
5. **30d billed** — `billedHoursLast30d` rendered as `N.Nh`, or an em-dash when null. The cell carries a tooltip "Updated <relative-time>" reading from `billedHoursAsOf`.
6. **Active projects** — the count of `currentProjects[]` followed by an expand chevron (▶). Clicking the chevron toggles a sub-table below the row showing each `currentProjects[]` entry (project name link, phase badge, `Current: N%`, `Planned: N%` muted when zero, lifetime hours, variance chip). Default state: collapsed.
7. **Last reported** — relative time from `lastReportedAt`, or an em-dash when null.

The page MUST support client-side sorting on every column. Default sort is `name` ascending. The expanded state is local to the page session (not persisted across navigation).

The page is read-only; all edits live on `/people/:id`.

#### Scenario: Index lists every Person
- **GIVEN** the database contains N Person rows
- **WHEN** an authenticated user opens `/people`
- **THEN** the table renders N rows (modulo loading state)

#### Scenario: Over-committed person displays amber chip
- **GIVEN** Person Aaron with `defaultCapacityPct = 100`, `availabilityPct = 20`, `committedPct = 90` (over by 10)
- **WHEN** the index renders
- **THEN** Aaron's Capacity cell shows the "Over by 10%" amber chip

#### Scenario: Harvest-unlinked person flagged
- **GIVEN** Person Aaron with `harvestUserId = null`
- **WHEN** the index renders
- **THEN** Aaron's row shows the muted `Harvest` badge in the Role cell, and his 30d billed cell shows `—`

#### Scenario: Row expander reveals current projects
- **GIVEN** Person Aaron with two current projects (one allocation-only, one with both)
- **WHEN** the user clicks the chevron in Aaron's Active projects cell
- **THEN** a sub-table renders below Aaron's row with both project rows; clicking again collapses it

#### Scenario: Sort by 30d billed descending
- **GIVEN** three people with 30d billed values 100, 40, 0
- **WHEN** the user clicks the 30d billed header twice (asc, then desc)
- **THEN** the rows reorder 100, 40, 0; people with null values sort last in both directions

#### Scenario: Index page navigates to detail
- **GIVEN** the index is rendered
- **WHEN** the user clicks a name link
- **THEN** the browser navigates to `/people/:id` for that person

### Requirement: Insights page at `/insights`
The system SHALL provide an Insights page at `/insights` accessible ONLY to users with role `PM` or `isAdmin === true`. Viewers attempting the route MUST be redirected away or receive a 403 from any data endpoint backing the page; the link MUST NOT appear in the navigation for them.

The page MUST render a two-pane layout at viewport widths ≥ 960px:
- **Left pane (≈60% width)**: scrollable metrics, top-to-bottom — KPI tile row, per-project metrics table, per-user metrics table, trend charts.
- **Right pane (≈40% width, ~420px target)**: sticky Claude chat pane (see capability `insights-chat`).

Below 960px the panes stack vertically: metrics on top, chat below.

**KPI tile row** MUST include, at minimum:
- Active projects (state ≠ Done)
- At risk (latest weekly RAG ≠ Green AND state ≠ Done)
- **Recovered this week** — projects whose latest `ProjectRiskUpdate.weekOf = current ISO Monday` has `ragLevel = Green` AND whose previous-week update has `ragLevel ≠ Green`. Surfaces "we got better this week" alongside the at-risk count.
- Over budget (Σ spent across pinned Harvest projects > Σ budget)
- Launching ≤ 30 days
- Hours billed (last 7 days, org-wide)
- Hours billed (last 30 days, org-wide)
- Active customers (customers with ≥1 non-Done project)

**Per-project metrics table** MUST be sortable on every rendered column. One row per project where `state ≠ Done`. Columns: project name (link), customer (link), phase, state, latest RAG chip, weeks-stuck-at-current-RAG, days in current phase (from `PhaseAuditLog`), budget hours, spent hours, percent of budget, slip days (`target_go_live − baseline_go_live`, null when either date missing), last-30-days hours.

**Per-user metrics table** MUST be sortable on every column. One row per Harvest-linked person. Columns: name (link), role chip, committed % (Σ `weeklyPct`), available % (`availabilityPct`), default capacity %, last 7 days hours, last 30 days hours, active project count (the same union the Workload section uses), over-commit chip when `committed + availability > default`.

**Trend charts** MUST render two compact charts side-by-side (or stacked on narrow viewports):
1. **Hours billed per week** — last 8 ISO weeks (Monday-anchored), org-wide. Vertical bar chart; week label below each bar; tooltip showing the exact total.
2. **RAG distribution per week** — last 8 ISO weeks. Stacked bar per week (Red/Amber/Green segments proportional to count).

All metrics MUST read from a single new server endpoint `GET /api/insights/overview` (see capability `insights-chat`) so the page renders in one round trip.

#### Scenario: Viewer cannot access /insights
- **GIVEN** an authenticated user with role `Viewer` and `is_admin = false`
- **WHEN** they navigate to `/insights`
- **THEN** the page does not render (route is gated); the `Insights` nav link is also absent

#### Scenario: PM sees the full page
- **GIVEN** an authenticated user with role `PM`
- **WHEN** they navigate to `/insights`
- **THEN** the KPI tile row, both metrics tables, the trend charts, and the chat pane all render

#### Scenario: Recovered KPI surfaces a project that turned Green this week
- **GIVEN** project A's most recent `ProjectRiskUpdate.weekOf = currentMonday` has `ragLevel = Green` and its previous week's update has `ragLevel = Red`
- **WHEN** the Insights page renders
- **THEN** project A contributes to the "Recovered this week" tile count

#### Scenario: Recovered KPI excludes projects that have been Green the whole time
- **GIVEN** project B's latest two `ProjectRiskUpdate` rows are both `Green`
- **WHEN** the page renders
- **THEN** project B is NOT counted in "Recovered this week"

#### Scenario: Trend chart bars render with 8 weeks of data
- **GIVEN** weekly hours and weekly RAG distribution data exist for the last 8 ISO weeks
- **WHEN** the trend charts render
- **THEN** each chart shows exactly 8 bars/segments, oldest week on the left, current week on the right

#### Scenario: Per-project table sort by weeks-stuck
- **GIVEN** several at-risk projects with different `weeksStuckAtLevel` values
- **WHEN** the PM clicks the "Weeks stuck" column header twice (asc, then desc)
- **THEN** rows reorder by `weeksStuckAtLevel` descending; projects with zero/null stuck-count sort last

#### Scenario: Chat pane stacks below metrics on narrow viewports
- **GIVEN** the viewport is < 960px wide
- **WHEN** the page renders
- **THEN** the chat pane appears below the metrics column, not beside it

