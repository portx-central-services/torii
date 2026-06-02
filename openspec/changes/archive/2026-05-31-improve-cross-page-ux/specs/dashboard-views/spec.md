## MODIFIED Requirements

### Requirement: Navigation shell
The system SHALL render a persistent navigation shell with the order **Timeline → Risks → Projects → Capacity → Trackers**. The shell MUST show the signed-in user's name and a sign-out action. The Trackers link MUST be visible only to admins.

The header band (Torii logo + nav links) MUST be sticky to the top of the viewport so it remains visible while the main content scrolls. The signed-in user footer MUST be sticky to the bottom of the viewport so it remains visible regardless of page length. The main content scroll region sits between the two sticky bands. Both bands MUST have a solid background so scrolling content does not bleed through.

#### Scenario: Nav order
- **GIVEN** any authenticated user opens any page
- **WHEN** the nav shell renders
- **THEN** the visible links appear in the order Timeline, Risks, Projects, Capacity (and Trackers when the user is admin)

#### Scenario: Header sticky on long pages
- **GIVEN** a user on `/projects` with 200 rows that overflow the viewport
- **WHEN** the user scrolls the page
- **THEN** the header band (logo + nav links) remains visible at the top of the viewport at every scroll position

#### Scenario: User footer sticky on long pages
- **GIVEN** the same scrolled page
- **WHEN** the user scrolls toward the bottom
- **THEN** the signed-in user band remains visible at the bottom of the viewport at every scroll position

#### Scenario: Admin sees Trackers link
- **GIVEN** an authenticated user with `PM` role and `is_admin=true`
- **WHEN** any page is rendered
- **THEN** the navigation includes a `Trackers` link

#### Scenario: Non-admin does not see Trackers link
- **GIVEN** an authenticated user with `is_admin=false`
- **WHEN** any page is rendered
- **THEN** the `Trackers` link is not present in the navigation

#### Scenario: Risks and Timeline are visible to all authenticated users
- **GIVEN** any authenticated user (PM or Viewer)
- **WHEN** any page is rendered
- **THEN** the navigation includes both `Risks` and `Timeline` links

## ADDED Requirements

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
