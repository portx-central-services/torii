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

### Requirement: Planned hours derived from an allocation
The system SHALL compute planned hours for any `Allocation` row using the formula:

```
plannedHours =
  (allocation.pct / 100) ×
  (person.defaultCapacityPct / 100) ×
  40h × weeksBetween(allocation.start, allocation.end)
```

`weeksBetween` is the count of weeks (allowing fractional values) between the two ISO dates: `(end - start) / (7 days)`. The formula MUST be a pure function shipped from `packages/shared` so the API, the web, and any future tests share one implementation.

#### Scenario: Standard allocation
- **GIVEN** an allocation with `pct=50`, `start=2026-06-01`, `end=2026-07-27` (8 weeks), and the assigned person's `defaultCapacityPct=100`
- **WHEN** `plannedHoursForAllocation` is called
- **THEN** the result equals `0.5 × 1.0 × 40 × 8 = 160` hours

#### Scenario: Part-time person scales the planned hours
- **GIVEN** an allocation with `pct=100` over 4 weeks for a person with `defaultCapacityPct=50`
- **WHEN** `plannedHoursForAllocation` is called
- **THEN** the result equals `1.0 × 0.5 × 40 × 4 = 80` hours

#### Scenario: Fractional weeks are not floored
- **GIVEN** an allocation spanning exactly 3.5 weeks at `pct=100` and `defaultCapacityPct=100`
- **WHEN** the helper is called
- **THEN** the result equals 140 hours, not 120

### Requirement: Variance bucket helper
The system SHALL classify an `(planned, actual)` pair into one of four variance buckets:

- `green` when `planned > 0` AND `|actual − planned| / planned ≤ 0.10`
- `amber` when `planned > 0` AND `0.10 < |actual − planned| / planned ≤ 0.25`
- `red` when `planned > 0` AND `|actual − planned| / planned > 0.25`
- `neutral` when `planned = 0` OR `actual` is null (e.g., the Person isn't linked to a Harvest user)

#### Scenario: Within 10% is green
- **GIVEN** planned=100, actual=105
- **WHEN** `varianceBucket(100, 105)` is called
- **THEN** the result is `'green'`

#### Scenario: 30% over is red
- **GIVEN** planned=100, actual=130
- **WHEN** the helper is called
- **THEN** the result is `'red'`

#### Scenario: 30% under is also red (signed delta, unsigned bucket)
- **GIVEN** planned=100, actual=70
- **WHEN** the helper is called
- **THEN** the result is `'red'` (the variance sign is preserved separately by the caller; the bucket is unsigned)

#### Scenario: No actuals (unlinked person) is neutral
- **GIVEN** planned=100, actual=null
- **WHEN** the helper is called
- **THEN** the result is `'neutral'`

### Requirement: Per-person reconciliation endpoint
The system SHALL expose `GET /api/people/:id/reconciliation` returning per-project planned-vs-actual rows for the named Person. The endpoint MUST:

- Join the person's `allocations` against `projects` and `project_harvest_snapshots`.
- Group by project; compute total planned hours via the shared helper across every allocation row this person has on the project.
- Compute total actual hours by summing every `breakdown.tasks[].people[]` entry where `people[i].personId === person.harvest_user_id` across all linked projects.
- Return rows ordered alphabetically by project name.
- When the Person's `harvest_user_id` is null, every row's `actualHours`, `variance`, and `variancePct` MUST be null and `linkedToHarvest: false`.
- When the Person has no allocations, the response MUST be an empty array.

#### Scenario: Linked person with one project allocation
- **GIVEN** a Person with `harvest_user_id` set; one allocation on Project X for 8 weeks @ 50% (160h planned); Project X's snapshot shows this person logged 145h
- **WHEN** a client reads `/api/people/:id/reconciliation`
- **THEN** the response is a single row `{ projectId, projectName, plannedHours: 160, actualHours: 145, variance: -15, variancePct: -9.375, linkedToHarvest: true }`

#### Scenario: Person not linked to a Harvest user
- **GIVEN** a Person with `harvest_user_id` null, one allocation on Project X
- **WHEN** the endpoint is called
- **THEN** the row's `actualHours`, `variance`, `variancePct` are all null and `linkedToHarvest: false`

#### Scenario: Person with no allocations
- **GIVEN** a Person with no `allocations` rows
- **WHEN** the endpoint is called
- **THEN** the response is `[]`

