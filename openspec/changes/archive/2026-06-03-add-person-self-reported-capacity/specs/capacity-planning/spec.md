## ADDED Requirements

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
