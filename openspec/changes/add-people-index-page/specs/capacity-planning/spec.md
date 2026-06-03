## ADDED Requirements

### Requirement: Person.billed_hours_last_30d + billed_hours_as_of
The system SHALL persist two new columns on `Person`: `billed_hours_last_30d` (nullable `Decimal(10,2)`) and `billed_hours_as_of` (nullable `TIMESTAMPTZ`). Together they cache the person's Harvest hours logged in the trailing 30-day window at the time of the last successful sync.

`billed_hours_last_30d` SHALL be `null` when the Person has no `harvest_user_id` OR the sync has not yet computed a value. It SHALL be `0` (not null) when the Person is Harvest-linked AND the sync ran AND no entries fell in the window — to distinguish "Harvest-linked but currently inactive" from "Harvest-unlinked, no data possible."

`billed_hours_as_of` SHALL be set to the sync timestamp whenever `billed_hours_last_30d` is updated. Null when the value is null.

#### Scenario: Defaults are null
- **WHEN** a new Person is created (via Monday sync or manually)
- **THEN** both `billed_hours_last_30d` and `billed_hours_as_of` are null

#### Scenario: Harvest-unlinked person keeps nulls after a sync
- **GIVEN** Person Aaron with `harvest_user_id = null`
- **WHEN** the scheduled Harvest sync runs
- **THEN** Aaron's `billed_hours_last_30d` and `billed_hours_as_of` are still null

#### Scenario: Linked person with zero recent activity gets zero, not null
- **GIVEN** Person Aaron with `harvest_user_id = "12345"` and no time entries in the last 30 days
- **WHEN** the scheduled Harvest sync runs
- **THEN** Aaron's `billed_hours_last_30d` is `0` and `billed_hours_as_of` is the sync timestamp

### Requirement: Sync-side 30-day billed-hours aggregation
The system SHALL compute every Person's `billed_hours_last_30d` as a tail-of-sync side effect of the existing Harvest scheduled refresh. The aggregation MUST:

1. Run AFTER all per-project snapshot refreshes complete, so it sees the freshest entry data.
2. Walk every project's time-entry list (the same `raw.timeEntries` arrays the snapshot already collects), filter to entries with `spent_date >= today − 30d`, sum `hours` bucketed by `user.id`.
3. For every Person whose `harvest_user_id` matches a bucket, update `billed_hours_last_30d` to the summed value and `billed_hours_as_of` to the current sync timestamp.
4. For every Person whose `harvest_user_id` is set but appears in NO bucket, update `billed_hours_last_30d` to `0` (not null) and `billed_hours_as_of` to the current sync timestamp.
5. Errors in the rollup MUST be caught and logged; they MUST NOT fail the surrounding sync.

#### Scenario: Aggregation runs after per-project refresh
- **GIVEN** a Harvest sync over 50 projects, where the per-project loop completes successfully
- **WHEN** the engine moves to the 30-day rollup step
- **THEN** the rollup sees every project's time entries from the refresh pass; no second Harvest API call is made

#### Scenario: Rollup error doesn't fail the sync
- **GIVEN** an unexpected error in the 30-day aggregation step
- **WHEN** the sync runs
- **THEN** the error is logged, `lastSyncedAt` is still updated, and `tracker_connections.status` remains `ok`

### Requirement: `GET /api/people/overview`
The system SHALL expose `GET /api/people/overview` returning a list of every Person with workload + Harvest signals joined in. Accessible to any authenticated user. Response shape:

```ts
Array<{
  id: string;
  name: string;
  email: string;
  role: Role;
  isAdmin: boolean;
  harvestUserId: string | null;
  defaultCapacityPct: number;
  availabilityPct: number;
  committedPct: number;                  // Σ weeklyPct across this person's capacity rows
  billedHoursLast30d: number | null;
  billedHoursAsOf: string | null;
  lastReportedAt: string | null;          // most recent person_project_capacities.updated_at; null when no rows
  currentProjects: Array<{
    projectId: string;
    projectName: string;
    projectPhase: Phase;
    weeklyPct: number;        // self-reported; 0 when no row exists
    allocatedPct: number;     // Σ Allocation.pct for active allocations only
    lifetimeHours: number | null;
    varianceBucket: 'green' | 'amber' | 'red' | 'neutral';
  }>;
}>
```

The `currentProjects` array MUST be the union of (active allocations: today between start and end) and (non-zero `person_project_capacities` rows) for the person — same definition as the per-person workload endpoint.

The endpoint MUST NOT require any query parameters. Default ordering is by `name` ascending; the client sorts in browser.

#### Scenario: Endpoint returns one row per Person
- **WHEN** an authenticated user reads `GET /api/people/overview`
- **THEN** the response array length equals the count of `Person` rows in the database

#### Scenario: committedPct sums correctly across capacity rows
- **GIVEN** Person Aaron with two `person_project_capacities` rows: 40% on project A and 30% on project B
- **WHEN** a client reads the endpoint
- **THEN** Aaron's row has `committedPct = 70`

#### Scenario: currentProjects union with allocation-only and capacity-only entries
- **GIVEN** Person Aaron with an active 50% allocation on project A AND a 30% self-reported capacity on project B (no overlap)
- **WHEN** a client reads the endpoint
- **THEN** Aaron's `currentProjects` has two entries: A with `allocatedPct = 50, weeklyPct = 0` and B with `allocatedPct = 0, weeklyPct = 30`

#### Scenario: Harvest-unlinked Person has null billedHoursLast30d
- **GIVEN** Person Aaron with `harvest_user_id = null`
- **WHEN** a client reads the endpoint
- **THEN** Aaron's row has `billedHoursLast30d = null` and `billedHoursAsOf = null`

#### Scenario: Unauthenticated reader is rejected
- **WHEN** an unauthenticated client reads the endpoint
- **THEN** the response is 401
