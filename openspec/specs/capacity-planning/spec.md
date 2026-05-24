# capacity-planning Specification

## Purpose
TBD - created by archiving change add-integration-dashboard. Update Purpose after archive.
## Requirements
### Requirement: Person entity
The system SHALL persist a Person entity with `id`, `name`, `email` (unique), `role` (`PM` or `Viewer`), and `default_capacity_pct` (default `100`). Persons MAY be created manually by an admin or auto-provisioned on first SSO sign-in.

#### Scenario: Auto-provision a person on first sign-in
- **GIVEN** a Google/Okta SSO sign-in for an email not yet known to the system
- **WHEN** the OIDC callback succeeds
- **THEN** the system creates a Person record with `role` defaulting to `Viewer` and `default_capacity_pct` of `100`

### Requirement: Allocation entity
The system SHALL persist an Allocation linking a `person_id` to a `project_id` with a `pct` (0–100), a `start` date, and an `end` date. Multiple allocations per (person, project) pair MAY exist as long as their date ranges do not overlap.

#### Scenario: Create an allocation
- **GIVEN** an existing Person and Project
- **WHEN** a PM submits `POST /api/allocations` with `pct=50`, `start=2026-06-01`, `end=2026-08-31`
- **THEN** the system creates the allocation and returns `201`

#### Scenario: Reject overlapping allocation for same person+project
- **GIVEN** an existing allocation for Person A on Project X from 2026-06-01 to 2026-08-31
- **WHEN** a PM submits another allocation for Person A on Project X from 2026-07-01 to 2026-09-30
- **THEN** the system returns `409` with a date-overlap error

### Requirement: Team-level capacity rollup
The system SHALL expose a rollup endpoint that, for a given date range, returns total demand (sum of allocation `pct` across all persons) per project AND total committed allocation per person, bucketed by week.

#### Scenario: Get weekly rollup
- **WHEN** a user requests `GET /api/capacity/rollup?from=2026-06-01&to=2026-06-28`
- **THEN** the system returns four weekly buckets, each containing per-project demand totals and per-person committed totals

### Requirement: Per-person drill-down
The system SHALL expose a per-person view returning every active allocation across all projects for a given date range, with each row including project name, project phase, project state, `pct`, `start`, and `end`.

#### Scenario: View one person's allocations
- **WHEN** a user requests `GET /api/people/{id}/allocations?from=2026-06-01&to=2026-09-30`
- **THEN** the system returns every allocation overlapping that window, joined with project name, phase, and state

### Requirement: Over-allocation detection
The system SHALL flag any week in which a person's total committed `pct` (sum of allocations active in that week) exceeds their `default_capacity_pct`. The flag MUST appear in both the rollup response and the per-person view.

#### Scenario: Detect over-allocation
- **GIVEN** Person A with `default_capacity_pct=100`, with allocations totalling `120%` for the week of 2026-07-06
- **WHEN** the rollup or per-person endpoint is queried over a range that includes that week
- **THEN** the response marks that week as `over_allocated: true` with the computed total

