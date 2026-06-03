## Constraints

- ~454 Torii projects, an unknown but small number of distinct customers (estimate <100 at PortX's current scale). A single backfill migration handles the volume; no streaming or batching needed.
- Harvest's `clients` resource gives us stable numeric IDs for customers. Monday gives us free-text strings in `details.customer_*`. Harvest is the authoritative identity source for cross-system customer linkage.
- The existing `ProjectHarvestSnapshot.raw` JSON column already contains the Harvest API project response, which includes the `client: { id, name }` block. The migration can read customer identity from cached data without an extra Harvest API roundtrip.
- The `harvest_project_id` field on `projects` is unique today, enforced by `@@unique([harvestProjectId])`. Replacing this with the new model removes that enforcement at the projects table; the equivalent invariant ("a Harvest project belongs to at most one Torii project") moves to `harvest_projects.project_id` being a non-unique nullable FK plus admin discipline. We accept this: pinning to two Torii projects would surface in the UI immediately and is easily corrected.

## Decisions

### D1 — Customer is a first-class entity, sourced from Harvest's `clients` resource

We considered a "soft customer" derivation (group projects by `details.customer_type` string + Harvest's `client_name`) but rejected it. Soft grouping never converges: Monday strings drift, Harvest names drift, and the join key is whatever the admin happened to type last. Hard customer identity needs a row, an ID, and a deliberate link.

The authoritative customer name + ID space is **Harvest's `clients`**. Every active billing relationship is already represented there, and the IDs are stable. Monday's `details.customer_*` strings stay as historical metadata but don't drive identity.

For Torii customers without a Harvest counterpart (early-stage engagements that haven't been set up in Harvest yet), `customers.harvest_client_id` is nullable — they exist but are "Harvest-unlinked." This is the same nullable-bridge pattern as `Person.harvest_user_id`.

### D2 — `harvest_projects` replaces `project_harvest_snapshots`; the snapshot is per-Harvest-project, not per-Torii-project

The previous model was driven by "one snapshot per project" simplicity. Now that multiple Harvest projects can roll up to one Torii project, the snapshot has to live where the snapshot's *granularity* lives — on the Harvest project itself. The new `harvest_projects` table carries `budget_hours`, `spent_hours_*`, `breakdown` directly.

Aggregation back up to the Torii project is computed at read time by summing across `harvest_projects` with matching `project_id`. With at most a handful of Harvest projects per Torii project, the cost is trivial.

This also resolves the awkwardness of `ProjectHarvestSnapshot.raw` — the raw Harvest payload is for one Harvest project, so it belongs on a per-Harvest-project row.

### D3 — Pinning a Harvest project to a Torii project is optional and admin-driven

A Harvest project can be:
- **Customer-only** (`customer_id` set, `project_id` null) — support work, ongoing retainer, or pre-delivery scoping. Hours roll up at the customer level only.
- **Pinned to a Torii project** (`customer_id` set, `project_id` set) — billing for one specific Monday delivery, typically named after the phase. Hours roll up to that project AND to the customer.

No auto-pinning by name. Admins make the call on the `/trackers` "pin" surface. The Harvest project name carries the hint (e.g., "Acme — UAT") but Torii doesn't parse it.

When a Monday project is created without a Harvest counterpart yet, that's fine — its reconciliation panel shows "no Harvest project pinned" with a link to the customer page. When the admin later creates the Harvest billing project and pins it, the panel lights up.

### D4 — `/api/projects/:id/harvest` returns an array; no backwards-compat single-snapshot shim

The endpoint used to return a single `HarvestSnapshot`. After this change it returns `{ harvestProjects: HarvestProjectSnapshot[] }`. The web client updates in lockstep — no shim wrapper that pretends "one" still works.

The existing `<HarvestPanel>` redraws to show N rows (one per pinned Harvest project) with budget/spent/breakdown per row, plus a header "Total across N Harvest projects" line. When `harvestProjects` is empty, the panel shows the "no Harvest project pinned" message described above.

### D5 — Customer page nav placement and overall navigation order

Customers live between Risks and Projects in the nav: **Dashboard → Timeline → Risks → Customers → Projects → Capacity → Trackers**. The reasoning: Customers is a "navigate downward" verb (start at a customer, see their projects), so it sits adjacent to Projects rather than at the front of the nav. Dashboard remains the synthesis layer at the front.

Same rule as Risks: visible to every authenticated user (read), edit gated to PM.

### D6 — Backfill is one shot, runs in the same migration as the schema change

The migration script:
1. Creates `customers` and `harvest_projects` tables and `projects.customer_id` column.
2. For each `project_harvest_snapshots` row, reads the cached `raw` JSON, extracts `client.id` + `client.name`, upserts `customers`, sets `projects.customer_id`, inserts a `harvest_projects` row with the snapshot data and `project_id` pointing back to the originating Torii project.
3. Drops `project_harvest_snapshots` and `projects.harvest_project_id`.

Single transaction. If the migration fails mid-way Postgres rolls everything back. We accept the rollback risk in exchange for the data integrity of a single atomic step.

Projects with no `harvest_project_id` get `customer_id = NULL`. Admin maps them later via the redesigned `/trackers` flow.

### D7 — `customers.name` is editable; the Harvest-client name is just the seed

When the admin links a Torii customer to a Harvest client, the customer's `name` defaults to the Harvest client name. The admin can rename it later (e.g., to normalize "Acme Corp." vs. "Acme Corporation"). Torii's `customers.name` is what shows in the UI; Harvest's name lives only in `customers.harvest_client_id`'s remote source.

The renaming is one-way: it doesn't push back to Harvest. We don't have write access to Harvest's clients API and wouldn't use it if we did.

### D8 — Reconciliation math at the customer level: planned and actual are summed independently, NOT averaged

For a customer with three Monday projects and four Harvest projects (two pinned, two support-only):

- `customerPlannedHours` = sum over all four projects of `Σ allocations × person.defaultCapacityPct × 40h × weeks`.
- `customerActualHours` = sum across all four Harvest projects' `spent_hours_billable + spent_hours_nonbillable`.
- `customerVarianceHours` = `customerActualHours - customerPlannedHours` (signed).
- `customerVariancePct` = `customerVarianceHours / customerPlannedHours` (or null when planned is zero).
- Plus a separate **`supportHours`** line item = sum across Harvest projects with `project_id IS NULL`, surfaced so the variance reading isn't quietly distorted by retainer time.

The same variance bucket helper (green/amber/red/neutral) applies. We do not introduce a separate "customer variance" bucket — the math is the same shape.

### D9 — The existing per-Monday-project ReconciliationPanel keeps its per-person rows, but the actuals come from summed Harvest projects

For a Monday project with two pinned Harvest projects, each person's `actualHours` row sums across both. Same shape as today, just summed at read-time. When a person logs hours against a Harvest project that's pinned to this Monday project but doesn't have an `Allocation` in Torii, they show up in the existing "Logged but not allocated" subsection (no change).

Customer-only Harvest projects (`project_id IS NULL`) are **not** considered for per-Monday-project reconciliation. They only show up at the customer level. This is intentional: customer-only hours can't be honestly assigned to one specific Monday project.

### D10 — Order of work: schema + backfill in one PR, UI surfaces follow incrementally

Splitting the change across multiple PRs would mean shipping a half-broken state (e.g., schema migrated but old UI still pointing at dropped tables). Single PR ships the migration, the new sync ingest, the multi-snapshot endpoint, the redesigned panels, and the new customer pages together.

Manual browser checks before merging:
- Existing projects with linked Harvest still render their HarvestPanel correctly (one Harvest project, post-migration).
- A test customer can be created with two Monday projects and a support Harvest project, and the customer page shows the right rollup.
- The `/trackers` redesigned flow can link a previously-unlinked customer and pin a Harvest project to a Monday project.
