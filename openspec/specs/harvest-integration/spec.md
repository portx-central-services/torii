# harvest-integration Specification

## Purpose
TBD - created by syncing change add-harvest-integration. Update Purpose after archive.
## Requirements
### Requirement: Per-project link to Harvest
The system SHALL link a Torii project to one or more Harvest projects via the `harvest_projects.project_id` FK. A Torii project MAY have zero, one, or many pinned Harvest projects under it; a Harvest project MAY have at most one pinned Torii project (the FK is nullable but, when set, identifies one specific project). The previously-existing `projects.harvest_project_id` field is REMOVED — the link lives on the Harvest-project side. Per-project link/unlink is performed via the HarvestProject pin endpoints (see "HarvestProject pin endpoints" above), NOT via project-side endpoints.

#### Scenario: Listing project's Harvest projects
- **GIVEN** Torii project Y with two pinned Harvest projects (X1 and X2) and one customer-only Harvest project (X3) under the same customer
- **WHEN** any client reads `GET /api/projects/:Y/harvest`
- **THEN** the response includes X1 and X2 but not X3 (customer-only)

### Requirement: Cached Harvest snapshot per linked project
The system SHALL maintain a cached snapshot row per Harvest project (in `harvest_projects`), NOT per Torii project. Each `harvest_projects` row carries `budget_hours`, `spent_hours_billable`, `spent_hours_nonbillable`, `breakdown`, `fetched_at`, `harvest_project_url`, and `raw`. The cache is refreshed by the scheduled bulk job and on-demand via the per-Harvest-project refresh endpoint. There is NO `project_harvest_snapshots` table; that data lives on `harvest_projects` rows.

#### Scenario: Snapshot survives migration
- **GIVEN** a project that had a `project_harvest_snapshots` row prior to the migration
- **WHEN** the migration runs
- **THEN** a `harvest_projects` row exists carrying the same `budget_hours`, `spent_hours_billable`, `spent_hours_nonbillable`, `breakdown`, and `fetched_at` values, with `project_id` pointing back to the originating Torii project

### Requirement: Snapshot read endpoint
The system SHALL expose `GET /api/projects/:id/harvest` returning `{ harvestProjects: HarvestProjectSnapshot[] }`. Each row in `harvestProjects` is the full snapshot shape for one pinned Harvest project under this Torii project. The array is ordered by `(isBillable DESC, name ASC)`. When no Harvest project is pinned to this project, the response is `{ harvestProjects: [] }` (empty array, not 404).

#### Scenario: Project with multiple pinned Harvest projects
- **GIVEN** Torii project Y with two pinned Harvest projects (X1 billable, X2 non-billable)
- **WHEN** a client reads `GET /api/projects/Y/harvest`
- **THEN** the response is `{ harvestProjects: [X1, X2] }` with X1 first (billable)

#### Scenario: Project with no pinned Harvest projects
- **GIVEN** Torii project Y with `customer_id` set but no pinned Harvest projects
- **WHEN** a client reads the endpoint
- **THEN** the response is `{ harvestProjects: [] }` and the HTTP status is 200

### Requirement: Refresh endpoint
The system SHALL expose `POST /api/projects/:id/harvest/refresh` (PM or admin) that refreshes every Harvest project pinned to this Torii project (in parallel) and returns the refreshed array, same shape as the read endpoint.

#### Scenario: Refresh of a multi-pin project
- **GIVEN** Torii project Y with two pinned Harvest projects
- **WHEN** a PM calls the refresh endpoint
- **THEN** both `harvest_projects` rows have their `fetched_at`, hours, and breakdown updated, and the response returns both refreshed snapshots

### Requirement: Bulk-refresh on the scheduled sync
The scheduled tracker sync (every 30 minutes) SHALL refresh the snapshot for every project linked to a Harvest project on an active connection. To respect Harvest's 100 req / 15 sec rate limit, the bulk refresh MUST issue calls in batches of at most 50, sleeping at least 15 seconds between batches. A 429 on any single project MUST log a warning and continue with the remaining projects.

#### Scenario: Scheduled bulk refresh paces calls
- **GIVEN** 200 Torii projects linked to Harvest and an active Harvest connection
- **WHEN** the scheduled sync runs
- **THEN** the engine issues at most 50 `getProjectSnapshot` calls per 15-second window; total runtime ≥ 45 seconds for 200 projects; every snapshot row's `fetched_at` advances; per-project 429 errors are isolated and logged

### Requirement: Derived `overBudget` on the project read API
The project read shape returned by `GET /api/projects` and `GET /api/projects/:id` SHALL include a boolean field `overBudget` derived from the cached Harvest snapshot:

```
overBudget = (snapshot.spent_hours_billable + snapshot.spent_hours_nonbillable) > snapshot.budget_hours
```

The field MUST be `false` when: no snapshot row exists, `budget_hours` is NULL, or `budget_hours` is 0. The field MUST NOT be persisted as a column and MUST NOT be writable on POST/PATCH.

#### Scenario: Spent exceeds budget
- **GIVEN** a project whose snapshot has `spent_hours_billable = 683.50`, `spent_hours_nonbillable = 155.00`, `budget_hours = 615`
- **WHEN** a client reads the project
- **THEN** the response includes `overBudget: true`

#### Scenario: Spent equals budget
- **GIVEN** a project whose total spent equals its budget exactly
- **WHEN** a client reads the project
- **THEN** the response includes `overBudget: false` (strict greater-than, not greater-than-or-equal)

#### Scenario: No budget set is not over budget
- **GIVEN** a project whose snapshot has `budget_hours = NULL` (no budget set in Harvest)
- **WHEN** a client reads the project
- **THEN** the response includes `overBudget: false`

#### Scenario: No snapshot is not over budget
- **GIVEN** a project with no Harvest link or no cached snapshot
- **WHEN** a client reads the project
- **THEN** the response includes `overBudget: false`

#### Scenario: List endpoint joins the snapshot table
- **GIVEN** 100 projects in the system (50 linked, 50 not)
- **WHEN** a client reads `GET /api/projects`
- **THEN** the response includes `overBudget` for every project; the API issues at most one additional SQL query (LEFT JOIN), not 100

### Requirement: HarvestPanel on the project detail page
The system SHALL render a Harvest panel on `/projects/:id` that shows ONE sub-row per pinned Harvest project. Each sub-row shows the Harvest project's name (link to `harvest_project_url`), billable/non-billable badge, budget hours, spent hours, percent-of-budget bar, last-fetched timestamp, and a refresh button (PM only). The panel header MUST show "N Harvest projects pinned" with N a count. Below the per-Harvest-project rows, a total line summarizes budget and spent across all pinned rows.

When no Harvest project is pinned (`harvestProjects` empty), the panel shows an empty state with the message "No Harvest project pinned for phase-level reconciliation" and a link to the customer page (`/customers/:customerId`) when `customerId` is set, OR a link to `/trackers` when the project has no customer yet.

#### Scenario: Multi-pin panel
- **GIVEN** Torii project Y with two pinned Harvest projects
- **WHEN** the project detail page renders
- **THEN** the HarvestPanel shows two sub-rows and a total line beneath them

#### Scenario: Empty state with customer
- **GIVEN** Torii project Y with `customerId` set but no pinned Harvest projects
- **WHEN** the page renders
- **THEN** the panel shows the empty-state message with a link to `/customers/:customerId`

#### Scenario: Empty state without customer
- **GIVEN** Torii project Y with `customerId = null`
- **WHEN** the page renders
- **THEN** the panel shows the empty-state message with a link to `/trackers` (so the admin can set up customer linking)

### Requirement: Budget chip in the project detail header
The system SHALL render an `<OnBudgetChip>` next to the existing `<StateBadge>` in the project header band when the project has a cached snapshot. The chip MUST render:

- "On budget" with a green style when `overBudget === false`.
- "Over budget −N%" with a red style when `overBudget === true`, where N = `Math.round((spent - budget) / budget * 100)`.

When no snapshot exists, the chip MUST NOT render (no "On budget" with no data).

#### Scenario: Over-budget project shows red chip with percentage
- **GIVEN** the Abrigo example (spent 838.50h, budget 615h → -36%)
- **WHEN** a user opens the project detail page
- **THEN** the chip reads "Over budget −36%" in red

#### Scenario: Under-budget project shows green chip
- **GIVEN** a project with spent 300h, budget 615h
- **WHEN** a user opens the project detail page
- **THEN** the chip reads "On budget" in green

#### Scenario: No snapshot hides the chip
- **GIVEN** a project with no Harvest link or no cached snapshot
- **WHEN** a user opens the project detail page
- **THEN** no chip is rendered next to the State badge

### Requirement: Cost and invoicing data are not surfaced
The system SHALL continue to expose hours-only data through every Harvest-derived surface. `HarvestProject.raw` MAY contain cost or invoicing fields from the Harvest API payload, but they MUST NOT appear in any API response, page, or schema. The `HarvestProjectSnapshotSchema` Zod schema MUST use `.strict()` to reject any payload smuggling monetary keys through the API layer.

#### Scenario: HarvestProjectSnapshot response carries no monetary fields
- **WHEN** a client reads `GET /api/projects/:id/harvest`
- **THEN** every `harvestProjects[]` row contains only hours-shaped numeric fields (`budgetHours`, `spentHoursBillable`, `spentHoursNonbillable`, `breakdown[].hours`) and no cost, rate, or invoice fields

#### Scenario: Strict schema rejects a smuggled monetary key
- **GIVEN** a malicious request body to a write endpoint with an extra `costCents` field
- **WHEN** the server validates the payload against `HarvestProjectSnapshotSchema`
- **THEN** validation fails with 400 and the payload is not persisted

### Requirement: Harvest user listing endpoint
The system SHALL expose `GET /api/tracker/harvest/users` (admin-only) returning every active Harvest user from the connected workspace, joined with the existing `Person.harvest_user_id` links. Each row MUST include:

- `harvestUserId` — the Harvest user's numeric ID as text
- `name`, `email` — from Harvest's `/v2/users` response
- `linkedToiriPersonId` — null when not yet linked
- `linkedToiriPersonName` — null when not yet linked

The endpoint MUST page through Harvest's `/v2/users` results (100 per page) and respect the rate limit (paged sequentially). On 429, surface as a 429 response with the standard retry-in-15s body. On no active Harvest connection, return 404.

#### Scenario: Healthy connection lists users with link state
- **GIVEN** an active Harvest connection and 3 Harvest users, one of whom is linked to a Torii Person
- **WHEN** an admin calls the endpoint
- **THEN** the response is 3 rows; the linked one carries `linkedToiriPersonId` and `linkedToiriPersonName`, the others have `null` for both

#### Scenario: Non-admin is rejected
- **GIVEN** a PM (not admin)
- **WHEN** they hit the endpoint
- **THEN** the response is 403; no Harvest call is made

#### Scenario: No connection
- **GIVEN** no Harvest connection exists
- **WHEN** an admin hits the endpoint
- **THEN** the response is 404

### Requirement: Per-Person Harvest user-link endpoints
The system SHALL expose two admin-only mutation endpoints to manage the `Person.harvest_user_id` bridge:

- `POST /api/people/:id/harvest-link` — body `{ harvestUserId: string }`. Sets the Person's `harvest_user_id`. Resolves the harvestUserId via `listUsers()` to confirm it exists in the workspace; rejects with 400 when the Harvest user is unknown OR when another Person already holds that `harvest_user_id` (uniqueness enforced by the existing index).
- `DELETE /api/people/:id/harvest-link` — clears the Person's `harvest_user_id`. Returns 204.

Both endpoints MUST reject non-admin callers with 403.

#### Scenario: Admin links a Person to a Harvest user
- **GIVEN** an admin, a Person with `harvest_user_id` null, and a valid Harvest user `12345`
- **WHEN** the admin POSTs `{ harvestUserId: "12345" }`
- **THEN** the Person's `harvest_user_id` is set to `"12345"` and the response is 200

#### Scenario: Linking a Harvest user already used elsewhere is rejected
- **GIVEN** Person A is already linked to Harvest user `12345`
- **WHEN** an admin tries to link Person B to the same `12345`
- **THEN** the response is 400; Person B's link is unchanged

#### Scenario: Linking an unknown Harvest user is rejected
- **GIVEN** no Harvest user `99999` exists in the workspace
- **WHEN** an admin tries to link a Person to `99999`
- **THEN** the response is 400; no Person row is updated

#### Scenario: Non-admin cannot link
- **GIVEN** a PM (not admin)
- **WHEN** they hit either endpoint
- **THEN** the response is 403

#### Scenario: Unlink clears the FK
- **GIVEN** an admin and a Person with `harvest_user_id` set
- **WHEN** they DELETE the link endpoint
- **THEN** the Person's `harvest_user_id` is null and the response is 204

### Requirement: /trackers Harvest user-link table
The `/trackers` page SHALL render a `<HarvestUserLinkTable>` below the existing `<HarvestLinkTable>` whenever a healthy Harvest connection exists. The table MUST:

- Show one row per Harvest user from `GET /api/tracker/harvest/users`.
- Display the Harvest user's name + email + the current link state (linked Torii Person name, or empty).
- Render a `<select>` per unlinked row offering the full list of Torii People (from `GET /api/people`), filtered to those who aren't already linked to a different Harvest user. Selecting one calls the link endpoint.
- For already-linked rows, render the linked Person's name as plain text with a small "Unlink" affordance that calls the DELETE endpoint.

After any link / unlink, the table re-fetches both queries (Harvest users + Torii People) so the dropdown options update.

#### Scenario: Admin sees the table on /trackers
- **GIVEN** an admin and a healthy Harvest connection
- **WHEN** they open `/trackers`
- **THEN** the Harvest user-link table is rendered below the project-link table

#### Scenario: Bulk link submits per-row
- **GIVEN** the admin has selected Torii Person A for Harvest user 1 and "Skip" for Harvest user 2
- **WHEN** they save
- **THEN** one `POST /api/people/:id/harvest-link` call is made for Harvest user 1; no call for Harvest user 2

#### Scenario: Unlink affordance clears the link
- **GIVEN** a row that is already linked
- **WHEN** the admin clicks "Unlink"
- **THEN** the corresponding `DELETE /api/people/:id/harvest-link` is called and the row re-renders as "available for linking"

### Requirement: Customer entity
The system SHALL persist a `Customer` row per Torii customer, with: `id` (cuid), `name` (string), `harvestClientId` (string, nullable, unique — the Harvest `clients` resource ID), `createdAt`, `updatedAt`. A customer is the cross-system anchor between Monday projects (one customer → many `Project` rows) and Harvest projects (one customer → many `HarvestProject` rows). `harvest_client_id` is the authoritative customer ID space for cross-system linkage; Monday's `details.customer_*` strings remain as historical metadata but do NOT drive identity.

#### Scenario: A customer can exist without a Harvest client
- **GIVEN** an early-stage engagement whose Harvest billing project hasn't been set up yet
- **WHEN** an admin creates a customer via `POST /api/customers` with no `harvestClientId`
- **THEN** the customer is persisted with `harvest_client_id = NULL` and usable for binding Monday projects

#### Scenario: harvest_client_id is unique
- **GIVEN** a customer already linked to Harvest client ID `12345`
- **WHEN** another customer attempts to link to the same Harvest client via `POST /api/customers/:id/harvest-link`
- **THEN** the request fails with 409 Conflict and the second customer's `harvest_client_id` remains unchanged

### Requirement: HarvestProject entity
The system SHALL persist a `HarvestProject` row per Harvest project pulled from `GET /v2/projects?is_active=true`, with: `id` (the Harvest project's own numeric ID, stored as text, primary key), `name`, `customerId` (Customer FK, NOT NULL), `projectId` (Torii Project FK, nullable — set only when an admin pins this Harvest project to one specific Torii project), `isBillable` (boolean, from Harvest), `budgetHours` (decimal, nullable — the Harvest-side budget), `spentHoursBillable` + `spentHoursNonbillable` (decimal totals), `breakdown` (JSON, per-(task, person) rows, hours only), `fetchedAt`, `harvestProjectUrl`, `raw` (JSON, the original Harvest API payload for debugging).

Pinning a Harvest project to a Torii project (setting `projectId`) is admin-driven and optional. When set, the Harvest project's hours roll up to that Torii project's reconciliation surface. When NULL, the Harvest project is "customer-only" — its hours roll up at the customer level only (the typical "support" case).

#### Scenario: HarvestProject defaults to customer-only
- **WHEN** the scheduled Harvest refresh ingests a Harvest project for the first time
- **THEN** `customer_id` is set from the Harvest project's `client.id` (failing the upsert if no `Customer` row matches), and `project_id` is NULL until an admin pins it

#### Scenario: Pin enforces same-customer constraint
- **GIVEN** Harvest project X (customer A) and Torii project Y (customer B)
- **WHEN** an admin calls `POST /api/tracker/harvest/projects/X/pin` with `{ toriiProjectId: Y }`
- **THEN** the request fails with 400; pinning requires the Torii project's customer to match the Harvest project's customer

#### Scenario: Multiple Harvest projects pin to the same Torii project
- **GIVEN** Torii project Y under customer A
- **WHEN** admin pins two distinct Harvest projects (X1 and X2, both under customer A) to Y
- **THEN** both pins succeed; the project's reconciliation surface aggregates across both

### Requirement: `GET /api/tracker/harvest/clients`
The system SHALL expose an admin-only endpoint listing every active Harvest client, joined to local customer state. Response shape: `Array<{ harvestClientId: string, name: string, linkedToiriCustomerId: string | null, linkedToiriCustomerName: string | null }>`. The data source is `listClients()` on the Harvest adapter (`GET /v2/clients?is_active=true`); local data is the `customers` table.

#### Scenario: Admin sees mixed linked/unlinked clients
- **WHEN** an admin reads `GET /api/tracker/harvest/clients`
- **THEN** the response lists every active Harvest client, with `linkedToiriCustomerId` populated for those bound to a Torii customer and null otherwise

#### Scenario: Non-admin is rejected
- **WHEN** a non-admin user reads the endpoint
- **THEN** the response is 403

### Requirement: Customer ↔ Harvest client link endpoints
The system SHALL expose `POST /api/customers/:id/harvest-link` (`{ harvestClientId }`) and `DELETE /api/customers/:id/harvest-link`, both admin-only, to set or clear `customers.harvest_client_id`. The POST MUST fail with 409 if the target Harvest client is already linked to a different customer.

#### Scenario: Link Harvest client
- **GIVEN** an existing customer C with `harvest_client_id = NULL` and a Harvest client `12345` not bound to any other customer
- **WHEN** an admin calls `POST /api/customers/C/harvest-link` with `{ harvestClientId: "12345" }`
- **THEN** `customers.C.harvest_client_id = "12345"` and the response includes the updated customer

#### Scenario: Unlink Harvest client
- **GIVEN** a customer linked to Harvest client `12345`
- **WHEN** an admin calls `DELETE /api/customers/C/harvest-link`
- **THEN** `customers.C.harvest_client_id = NULL`

### Requirement: HarvestProject pin endpoints
The system SHALL expose `POST /api/tracker/harvest/projects/:harvestProjectId/pin` (`{ toriiProjectId }`) and `DELETE /api/tracker/harvest/projects/:harvestProjectId/pin`, both admin-only, to set or clear `harvest_projects.project_id`. The POST MUST validate that the Torii project's `customer_id` equals the Harvest project's `customer_id`.

#### Scenario: Pin succeeds when customer matches
- **GIVEN** Harvest project X and Torii project Y under the same customer
- **WHEN** admin calls `POST /api/tracker/harvest/projects/X/pin` with `{ toriiProjectId: Y }`
- **THEN** `harvest_projects.X.project_id = Y`

#### Scenario: Pin rejects on customer mismatch
- **GIVEN** Harvest project X (customer A) and Torii project Y (customer B)
- **WHEN** admin attempts the pin
- **THEN** the response is 400 and `harvest_projects.X.project_id` is unchanged
