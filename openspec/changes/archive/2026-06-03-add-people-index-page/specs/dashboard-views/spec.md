## MODIFIED Requirements

### Requirement: Navigation shell
The system SHALL render a persistent navigation shell with the order **Dashboard → Timeline → Risks → Customers → Projects → People → Capacity → Trackers**. The shell MUST show the signed-in user's name and a sign-out action. The Trackers link MUST be visible only to admins.

The header band (Torii logo + nav links) MUST be sticky to the top of the viewport so it remains visible while the main content scrolls. The signed-in user footer MUST be sticky to the bottom of the viewport so it remains visible regardless of page length. The main content scroll region sits between the two sticky bands. Both bands MUST have a solid background so scrolling content does not bleed through.

#### Scenario: Nav order
- **GIVEN** any authenticated user opens any page
- **WHEN** the nav shell renders
- **THEN** the visible links appear in the order Dashboard, Timeline, Risks, Customers, Projects, People, Capacity (and Trackers when the user is admin)

#### Scenario: People is visible to non-admin users
- **GIVEN** an authenticated user with role `Viewer` (`is_admin = false`)
- **WHEN** any page is rendered
- **THEN** the nav includes the `People` link

#### Scenario: Dashboard is the default landing
- **GIVEN** an authenticated user opens `/`
- **WHEN** the route resolves
- **THEN** the Portfolio Dashboard page renders

#### Scenario: Customers is visible to non-admin users
- **GIVEN** an authenticated user with role `Viewer`
- **WHEN** any page is rendered
- **THEN** the nav includes the `Customers` link

#### Scenario: Header sticky on long pages
- **GIVEN** a user on `/projects` with rows that overflow the viewport
- **WHEN** the user scrolls the page
- **THEN** the header band remains visible at the top of the viewport at every scroll position

#### Scenario: User footer sticky on long pages
- **GIVEN** the same scrolled page
- **WHEN** the user scrolls toward the bottom
- **THEN** the signed-in user band remains visible at the bottom of the viewport at every scroll position

#### Scenario: Admin sees Trackers link
- **GIVEN** an authenticated user with `is_admin=true`
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
