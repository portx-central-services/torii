## MODIFIED Requirements

### Requirement: Navigation shell
The system SHALL render a persistent navigation shell with the order **Dashboard → Timeline → Risks → Customers → Projects → Capacity → Trackers**. The shell MUST show the signed-in user's name and a sign-out action. The Trackers link MUST be visible only to admins.

The header band (Torii logo + nav links) MUST be sticky to the top of the viewport so it remains visible while the main content scrolls. The signed-in user footer MUST be sticky to the bottom of the viewport so it remains visible regardless of page length. The main content scroll region sits between the two sticky bands. Both bands MUST have a solid background so scrolling content does not bleed through.

#### Scenario: Nav order
- **GIVEN** any authenticated user opens any page
- **WHEN** the nav shell renders
- **THEN** the visible links appear in the order Dashboard, Timeline, Risks, Customers, Projects, Capacity (and Trackers when the user is admin)

#### Scenario: Dashboard is the default landing
- **GIVEN** an authenticated user opens `/`
- **WHEN** the route resolves
- **THEN** the Portfolio Dashboard page renders

#### Scenario: Customers is visible to non-admin users
- **GIVEN** an authenticated user with role `Viewer` (`is_admin = false`)
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
