## MODIFIED Requirements

### Requirement: Project entity
The system SHALL persist a `Project` row per delivery engagement, with: `id` (cuid), `name`, `phase` (enum), `state` (enum), `keyDates` (JSON), `ownerId` (Person FK, nullable), `trackerRef` (JSON {provider, externalId} or null), `trackerRaw` (JSON or null), `details` (JSON), `fieldMapping` (JSON), `customerId` (Customer FK, nullable), `projectManagerId` / `solutionArchitectId` / `solutionConsultantId` (Person FKs, nullable), `createdAt`, `updatedAt`. The project is the canonical Torii unit of delivery work; cross-system identity to Harvest billing is mediated by the customer entity and the per-Harvest-project link, NOT by a field on the project itself.

#### Scenario: Customer assignment is optional
- **GIVEN** a project created via Monday sync before any customer has been linked to that customer's Harvest client
- **WHEN** the project is persisted
- **THEN** `customer_id` is NULL and the project remains fully usable (rendered on `/projects`, editable, allocations + risks all work)

#### Scenario: Project read response includes resolved customer
- **WHEN** a client fetches `GET /api/projects/:id`
- **THEN** the response includes `customerId` (the FK value) and `customer` (a resolved `{ id, name }` row, or null)

#### Scenario: Project does not expose a Harvest project id directly
- **WHEN** any client fetches `GET /api/projects` or `GET /api/projects/:id`
- **THEN** the response shape does NOT include a `harvestProjectId` field; the link from project to Harvest project lives on the `harvest_projects` side as a `project_id` FK

### Requirement: Derived `overBudget` on the project read API
The system SHALL expose a boolean `overBudget` on every project read response, computed at read time as `(sum of spent_hours_billable + spent_hours_nonbillable across HarvestProject rows pinned to this project) > (sum of budget_hours across the same rows)`. The flag MUST be false when no Harvest project is pinned to this Torii project, when every pinned Harvest project has a null `budget_hours`, or when the total budget is zero. `overBudget` MUST NOT be persisted as a column on `projects`.

#### Scenario: Sums across multiple pinned Harvest projects
- **GIVEN** a Torii project with two pinned Harvest projects: A (budget 100h, spent 60h) and B (budget 80h, spent 30h)
- **WHEN** the project is read
- **THEN** `overBudget` is false (total spent 90h ≤ total budget 180h)

#### Scenario: One pinned Harvest project pushes the sum over budget
- **GIVEN** a Torii project with two pinned Harvest projects: A (budget 100h, spent 110h) and B (budget 80h, spent 50h)
- **WHEN** the project is read
- **THEN** `overBudget` is true (total spent 160h > total budget 180h is false — adjust example: A budget 100h spent 120h, B budget 0h spent 0h → total spent 120h, total budget 100h → true)

#### Scenario: No pinned Harvest projects
- **GIVEN** a Torii project with `customerId` set but no `harvest_projects` rows pinned (`project_id IS NULL` for all of the customer's Harvest projects)
- **WHEN** the project is read
- **THEN** `overBudget` is false
