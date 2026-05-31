## ADDED Requirements

### Requirement: Timeline view (Gantt)
The system SHALL provide a timeline view at `/timeline` accessible to any authenticated user. The view MUST render every filtered project as one row in a horizontal time-axis Gantt: time on the X axis, projects on the Y. Each project's bar MUST start at `keyDates.project_start` and end at `keyDates.target_go_live`. When `project_start` is absent, the bar MUST start at the visible window's left edge; when `target_go_live` is absent, the bar MUST end at the visible window's right edge. A project MUST always render — including projects with no scheduled dates at all (e.g., Backlog), which appear as full-width bars signaling "no committed schedule." The bar MUST be colored by the project's **current** `phase` using the seven-phase palette (`Backlog`, `Initiation`, `Design`, `Development`, `UAT`, `GoLiveReadiness`, `Production`).

When the project's real `project_start` exists and falls before the visible window, the bar's left edge MUST render with a dashed border ("clipped-left"); when the real `target_go_live` exists and falls after the visible window, the right edge MUST render with a dashed border ("clipped-right"). A missing date MUST NOT produce a dashed edge (absence is distinct from "extends beyond"). The bar MUST NOT carry any mid-bar milestone ticks — phase color is the sole phase signal.

The view MUST default to a 6-month window centered on today (today − 2 months → today + 4 months). Months MUST be labeled along the X axis. A vertical **today line** MUST cross the rows area at the current date when today falls inside the visible window.

The view MUST display a **KPI strip** above the chart showing six counts derived from the currently-filtered projects: total projects in view, distinct people (PM/SA/SC) involved, count in Active stage, count in `UAT`/`GoLiveReadiness`, count in `Development`, and count in `Backlog`/`Initiation`. The strip updates as filters change.

The view MUST expose a **view-mode toggle** between *By project* (one row per project, sorted by start date) and *By person*. In *By person* mode the chart groups visible projects by every distinct person who appears as PM, SA, or SC across the project's `details`, rendering a header row per person followed by one bar row per role assignment — a project with PM Aaron, SA Vitor, and SC Halan appears once under each of those three people. The role MUST be visible as a short badge (`PM`/`SA`/`SC`) on the row label.

The view MUST support the following filters: **date range** (window override; a project is hidden only when its real `project_start` lies strictly after the window OR its real `target_go_live` lies strictly before the window — projects with at least one missing endpoint always overlap), **project type** (`direct` | `fintech` | `both`, default `both`), **stage** (`Active` | `Committed` | `all`, default `all`), **state** (any subset of `OnTrack` / `AtRisk` / `Blocked` / `Done`), **phase** (any subset of the 7 phase values), **person** (dropdown of all distinct people across PM/SA/SC, or "All people"), and **role** (`PM` | `SA` | `SC` | "any role"). When both `person` and `role` are set, only projects where that person holds that specific role are kept; with `person` only, any role matches; with `role` only, any project having someone in that role qualifies. By default no filters are applied beyond the date window.

**Stage derivation**: a project is `Committed` iff `phase === 'Backlog'`; otherwise `Active`. (Note: Torii does not yet carry a Monday "Status" column, so an Initiation-phase project whose Monday status is "Not Started" reads as Active here — adding a status column later would tighten this.)

Each bar MUST surface two read-only overlays:
- An **at-risk** indicator (small RAG-colored dot at the bar's left edge) when the project is currently at-risk per the `risk-tracking` capability (most recent `ProjectRiskUpdate` has `ragLevel != Green`).
- An **over-budget** indicator (a small icon) when `project.overBudget === true`. This field defaults to `false` and remains so until a future Harvest integration sets it. The indicator slot MUST be present in the renderer so a future change can light it up without further UI work.

Clicking a bar MUST navigate to the project's detail page.

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

#### Scenario: Over-budget overlay is currently inert
- **GIVEN** a project with `overBudget` unset
- **WHEN** the timeline renders the project's bar
- **THEN** no over-budget indicator is rendered; the renderer is present and would render the indicator if `overBudget === true`

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

## MODIFIED Requirements

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
