## ADDED Requirements

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

## MODIFIED Requirements

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
