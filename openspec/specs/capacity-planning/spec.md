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
The system SHALL expose `GET /api/people/:id/reconciliation` returning per-project planned vs. actual hours for one Person across every project they're allocated on. The response shape is unchanged from the previous version (`Array<PersonReconciliationRow>`), but the `actualHours` computation for each row now sums across **every Harvest project pinned to that Torii project** (`harvest_projects.project_id = projectId`), filtered to the Person's `harvest_user_id` via the per-(task, person) breakdown. When the Person has no `harvest_user_id`, `actualHours`, `variance`, and `variancePct` are null.

When a Torii project has multiple pinned Harvest projects, `actualHours` is the sum across all of them for this Person. Customer-only Harvest projects (`project_id IS NULL`) MUST NOT be included in this per-Person, per-project rollup — those hours surface only on the customer reconciliation endpoint.

#### Scenario: Person with hours on multiple pinned Harvest projects under one Torii project
- **GIVEN** Person Aaron with `harvest_user_id` set, allocated to Torii project Y with two pinned Harvest projects (HP1: Aaron 30h, HP2: Aaron 20h)
- **WHEN** a client reads `GET /api/people/Aaron/reconciliation`
- **THEN** the row for Y has `actualHours = 50` (summed across HP1 + HP2)

#### Scenario: Customer-only hours are excluded from per-person per-project rollup
- **GIVEN** Person Aaron with hours on customer C's support Harvest project HS (not pinned to any Torii project), and an allocation to Y (a Monday project under C, also with no pinned Harvest project)
- **WHEN** a client reads `GET /api/people/Aaron/reconciliation`
- **THEN** the row for Y has `actualHours = 0` (HS's hours don't reconcile against Y); Aaron's HS hours appear only on the customer C reconciliation

### Requirement: Per-customer reconciliation endpoint
The system SHALL expose `GET /api/customers/:id/reconciliation` returning planned-vs-actual hours rolled up at the customer level. Accessible to any authenticated user. Response shape:

```ts
{
  customerId: string;
  customerName: string;
  plannedHours: number;          // sum across all Customer.projects of (Σ allocations × person.defaultCapacityPct × 40 × weeks)
  actualHours: number;           // sum across all Customer.harvestProjects of (spent_billable + spent_nonbillable)
  supportHours: number;          // sum across Customer.harvestProjects WHERE project_id IS NULL
  varianceHours: number;         // actualHours - plannedHours, signed
  variancePct: number | null;    // varianceHours / plannedHours, null when plannedHours = 0
  perProject: Array<{
    projectId: string;
    projectName: string;
    plannedHours: number;
    actualHours: number;          // sum across HarvestProjects with project_id = this projectId
    varianceHours: number;
    variancePct: number | null;
    linkedHarvestProjectIds: string[];
  }>;
}
```

The `supportHours` figure is broken out so a reader can interpret the customer-wide variance honestly — hours logged on support don't have a planned-hours counterpart, and surfacing them separately avoids quietly distorting the variance reading.

#### Scenario: Customer with mixed delivery and support
- **GIVEN** customer C with two Monday projects (P1, P2), two pinned Harvest projects (HP1 → P1, HP2 → P2), and one customer-only Harvest project HS (support)
- **WHEN** a client reads `GET /api/customers/C/reconciliation`
- **THEN** `actualHours` is the sum across HP1 + HP2 + HS; `supportHours` is HS's total; `perProject` has two entries (P1, P2), each with `actualHours` from only its pinned Harvest project

#### Scenario: Customer with no Harvest linkage
- **GIVEN** customer C with two Monday projects and no linked Harvest client
- **WHEN** a client reads the endpoint
- **THEN** `actualHours = 0`, `supportHours = 0`, `variancePct = null` if `plannedHours = 0`, and `perProject` rows have `actualHours = 0` and `linkedHarvestProjectIds = []`

#### Scenario: Unauthenticated reader is rejected
- **WHEN** an unauthenticated client reads the endpoint
- **THEN** the response is 401

### Requirement: PersonProjectCapacity entity
The system SHALL persist a `PersonProjectCapacity` row per (person, project) pair the person has self-reported time on, with: composite primary key `(person_id, project_id)`, `weekly_pct` (integer 0–100), `created_at`, `updated_at`. A row exists ONLY when the person has a non-zero self-reported weekly capacity for that project; setting `weekly_pct` to 0 via the API MUST remove the row. The entity carries no date range — it represents the person's current snapshot, overwritten on update.

Both FKs cascade on delete: when a `Person` or `Project` is deleted, all matching capacity rows are removed.

#### Scenario: Upsert with non-zero weekly_pct creates a row
- **GIVEN** a person with no capacity row for project P
- **WHEN** the person PATCHes `{ projects: [{ projectId: P, weeklyPct: 40 }] }` to `/api/people/:id/workload`
- **THEN** a `person_project_capacities` row exists for (person, P) with `weekly_pct = 40`

#### Scenario: Setting weekly_pct to 0 deletes the row
- **GIVEN** an existing capacity row for (person, P) with `weekly_pct = 40`
- **WHEN** the person PATCHes `{ projects: [{ projectId: P, weeklyPct: 0 }] }`
- **THEN** the row is removed and a subsequent GET returns no entry for P (unless P is also pulled in by an active allocation)

#### Scenario: Project deletion cascades
- **GIVEN** a capacity row exists for (person, project)
- **WHEN** the project is deleted
- **THEN** the capacity row is removed automatically (FK cascade)

### Requirement: Person.availability_pct
The system SHALL persist an `availability_pct` integer column on the `Person` model, default `0`, NOT NULL, range `0–100`. It represents the person's self-reported headroom for new commitments, expressed as a percentage of their `default_capacity_pct` baseline. The column is editable by the person themselves OR by an admin via `PATCH /api/people/:id/workload`.

#### Scenario: Default is zero
- **WHEN** a new `Person` is created (via Monday sync or manually)
- **THEN** `availability_pct` is 0

#### Scenario: Range enforced
- **WHEN** the API receives `PATCH /api/people/:id/workload` with `availabilityPct = 120`
- **THEN** the request fails with 400 and the column is unchanged

### Requirement: `GET /api/people/:id/workload`
The system SHALL expose `GET /api/people/:id/workload` returning the person's combined workload view. Accessible to any authenticated user. Response shape:

```ts
{
  availabilityPct: number;       // Person.availability_pct
  defaultCapacityPct: number;    // Person.default_capacity_pct, included for the advisory sum math
  lastReportedAt: string | null; // Most recent updated_at across this person's capacity rows; null when no rows
  projects: Array<{
    projectId: string;
    projectName: string;
    projectPhase: Phase;
    projectState: ProjectState;
    weeklyPct: number;           // Self-reported value, or 0 when no row exists
    allocatedPct: number;        // Sum of Allocation.pct for *active* allocations on this project (today between start and end)
    lifetimeHours: number | null;   // Sum across pinned harvest_projects breakdown rows for this person's harvest_user_id; null when unlinked
    varianceBucket: 'green' | 'amber' | 'red' | 'neutral';
  }>;
}
```

The `projects` array MUST contain every project in the union of (a) projects where this person has an active allocation overlapping today, and (b) projects where this person has a `person_project_capacities` row with `weekly_pct > 0`. A project appearing in only (a) renders with `weeklyPct = 0`. A project appearing in only (b) renders with `allocatedPct = 0`.

#### Scenario: Union of active allocations and self-reports
- **GIVEN** person Aaron with an active allocation on project A (`pct = 50`) and a self-reported capacity row on project B (`weekly_pct = 30`); no overlap
- **WHEN** a client reads `GET /api/people/Aaron/workload`
- **THEN** `projects` has two rows: A with `weeklyPct = 0, allocatedPct = 50` and B with `weeklyPct = 30, allocatedPct = 0`

#### Scenario: Project with both an allocation and a self-report
- **GIVEN** person Aaron with an active 50% allocation on project A AND a self-report of `weekly_pct = 80` on the same project
- **WHEN** a client reads the workload endpoint
- **THEN** the single row for A has `weeklyPct = 80, allocatedPct = 50` (both surfaced; not merged)

#### Scenario: Person not linked to a Harvest user
- **GIVEN** person Aaron with `harvestUserId = null`
- **WHEN** a client reads the workload endpoint
- **THEN** every `projects[*].lifetimeHours` is null and `varianceBucket` is `'neutral'`

#### Scenario: lastReportedAt reflects newest update
- **GIVEN** person Aaron with two capacity rows updated 2 days ago and 5 days ago respectively
- **WHEN** a client reads the workload endpoint
- **THEN** `lastReportedAt` equals the 2-day-old timestamp

#### Scenario: Unauthenticated reader is rejected
- **WHEN** an unauthenticated client reads the endpoint
- **THEN** the response is 401

### Requirement: `PATCH /api/people/:id/workload`
The system SHALL expose `PATCH /api/people/:id/workload` accepting a partial update of the person's self-reported workload. Body shape:

```ts
{
  availabilityPct?: number;                                  // 0-100
  projects?: Array<{ projectId: string; weeklyPct: number }>;
}
```

Authorization: the request is accepted ONLY when `viewer.id === person.id` OR `viewer.isAdmin === true`. Any other authenticated viewer receives 403. Each `weeklyPct` and `availabilityPct` MUST be in the inclusive range `0–100`; out-of-range values return 400.

For each entry in `projects[]`: when `weeklyPct > 0`, upsert the matching `person_project_capacities` row; when `weeklyPct === 0`, delete the row (or no-op when no row exists). All updates run in a single database transaction.

The endpoint MUST return the refreshed workload payload (same shape as the GET) so the client can update its view in one round trip.

#### Scenario: Self-edit
- **GIVEN** authenticated user Aaron (non-admin) editing his own workload
- **WHEN** Aaron PATCHes `/api/people/Aaron/workload` with `{ availabilityPct: 30 }`
- **THEN** the response is 200 and `Aaron.availability_pct` is set to 30

#### Scenario: Admin edit of another user
- **GIVEN** authenticated admin Drew editing Aaron's workload
- **WHEN** Drew PATCHes `/api/people/Aaron/workload` with `{ projects: [{ projectId: P, weeklyPct: 50 }] }`
- **THEN** the response is 200 and Aaron's capacity row for P is upserted

#### Scenario: Non-admin editing another user is rejected
- **GIVEN** authenticated user Drew (non-admin) attempting to edit Aaron's workload
- **WHEN** Drew PATCHes `/api/people/Aaron/workload` with any body
- **THEN** the response is 403 and no state changes

#### Scenario: Out-of-range value rejected
- **WHEN** the body contains `{ projects: [{ projectId: P, weeklyPct: 150 }] }`
- **THEN** the response is 400 and no row is created or updated

#### Scenario: weeklyPct: 0 deletes the existing row
- **GIVEN** a capacity row exists for (Aaron, P)
- **WHEN** Aaron PATCHes with `{ projects: [{ projectId: P, weeklyPct: 0 }] }`
- **THEN** the row is removed; the response payload's `projects` array reflects the deletion (P appears only if Aaron also has an active allocation on it)

#### Scenario: Sum is NOT enforced
- **GIVEN** Aaron's `defaultCapacityPct = 100` and two existing capacity rows totalling 90%
- **WHEN** Aaron PATCHes `{ projects: [{ projectId: P, weeklyPct: 30 }] }` (which would bring the sum to 120% — over capacity)
- **THEN** the PATCH succeeds; the over-commit is surfaced via the UI's advisory line, not blocked at the API

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

