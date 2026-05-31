## MODIFIED Requirements

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

#### Scenario: At-risk bar shows a RAG dot
- **GIVEN** a project currently at-risk per `risk-tracking` with `ragLevel = Amber`
- **WHEN** the timeline renders the project's bar
- **THEN** an Amber-colored dot is rendered at the bar's left edge

#### Scenario: KPI strip reflects the currently-filtered projects
- **GIVEN** the user applies a `phase=Development` filter
- **WHEN** the timeline renders
- **THEN** the "In Development" KPI equals the visible project count, and the other KPIs are recomputed against the same filtered set

#### Scenario: By-person view groups each role assignment under its person
- **GIVEN** a project with PM `Aaron`, SA `Vitor`, SC `Halan`, and the user selects "By person"
- **WHEN** the timeline renders
- **THEN** that project appears three times — once in Aaron's group with a `PM` badge, once in Vitor's with `SA`, once in Halan's with `SC`

#### Scenario: Click navigates to detail
- **WHEN** the user clicks a project bar
- **THEN** the browser navigates to `/projects/{id}` for that project

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
