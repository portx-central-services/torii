## Why

Torii currently models the Torii project ↔ Harvest project relationship as **1:1** — `projects.harvest_project_id` is unique, `project_harvest_snapshots` is keyed one row per project, the HarvestPanel and ReconciliationPanel both assume one snapshot per project. That model is wrong in the real world:

- A **customer** typically has **multiple Monday projects** (delivery streams, phases-as-projects, follow-on engagements).
- A **customer** typically has **multiple Harvest projects** (one per phase for billing, plus a long-running "support" project that exists between deliveries).
- A Harvest "support" project's hours are **customer-level**, not project-level — they don't belong to any single Monday project at all.

The right anchor is **Customer**. Both Monday projects and Harvest projects hang off a Customer; the Harvest-project ↔ Torii-project link becomes an *optional* narrower binding for the case where a Harvest project is unambiguously the billing side of one specific Monday delivery.

This change introduces `Customer` as a first-class entity, makes both `Project` and a new `HarvestProject` entity FK into it, and reshapes the linking + reconciliation surfaces around customer-as-anchor. Once shipped, the question Torii can answer becomes "how many hours did we burn on **Acme** this quarter, split across delivery vs. support?" — not just "how many hours on this one Monday project."

## What Changes

### Schema: introduce `Customer` and `HarvestProject`; relegate the project↔Harvest link to optional

New entities:

- `customers` — `id` (cuid), `name`, `harvest_client_id` (nullable, unique — present once the customer is linked to Harvest's `clients` resource), timestamps.
- `harvest_projects` — `id` (the Harvest project's own numeric ID, stored as text, primary key), `name`, `customer_id` FK (NOT NULL), `project_id` FK to Torii `projects` (nullable — set when this Harvest project is the billing side of one specific Monday project), `is_billable` (boolean, from Harvest), plus the **per-Harvest-project snapshot fields** previously on `project_harvest_snapshots`: `budget_hours`, `spent_hours_billable`, `spent_hours_nonbillable`, `breakdown` (JSON), `fetched_at`, `harvest_project_url`, `raw` (JSON).

Modified:

- `projects.customer_id` — new nullable FK to `customers`.
- `projects.harvest_project_id` — **removed.** The link now lives on `harvest_projects.project_id` (a Harvest project picks at most one Torii project; a Torii project can have many Harvest projects).
- `project_harvest_snapshots` — **dropped.** Its rows migrate into `harvest_projects` (one snapshot row per Harvest project, which is the right shape — Harvest is the unit Harvest serves).

Backfill in the same migration: for every existing `projects.harvest_project_id`, read the cached `ProjectHarvestSnapshot.raw` (which already contains `client.id` + `client.name`), upsert a Customer row keyed by `harvest_client_id`, set `projects.customer_id`, and create a `harvest_projects` row carrying the existing snapshot fields with `project_id` set to preserve the 1:1 link as the special case.

### Sync: customers and Harvest projects are pulled from Harvest, not extracted from Monday strings

The existing Monday sync continues to populate Torii `projects` from Monday items. **Customer identity is sourced from Harvest's `clients` API** (the authoritative ID space), not derived from Monday's free-text `details.customer_type` strings. The existing `details.customer_*` fields stay as historical Monday-extracted data but are no longer the basis for cross-system identity.

- New endpoint `GET /api/tracker/harvest/clients` (admin) — lists Harvest clients with each row's link state (`linkedToiriCustomerId`).
- New endpoint `POST /api/customers` (admin) and `POST /api/customers/:id/harvest-link` (admin) — create a Torii customer and optionally bind it to a Harvest client.
- The bulk-refresh sync (existing scheduled job) now also upserts `harvest_projects` rows from the Harvest projects API, attaching each to its Customer via the cached `harvest_client_id` mapping. Admin manually reviews any Harvest projects whose customer hasn't been mapped yet.

### Per-Harvest-project linking to a specific Torii project (the "phase" case)

When a Harvest project name maps cleanly to a single Monday delivery (e.g., `Acme — UAT phase`), an admin can pin `harvest_projects.project_id` to that Torii project. This narrows the reconciliation surface for that Harvest project to one Monday project. When not set, the Harvest project's hours roll up only at the customer level. No fuzzy matching — admins choose explicitly.

### Reconciliation: now two-tier

- **Per-Monday-project reconciliation** (existing `<ReconciliationPanel>` on `/projects/:id`) keeps working but aggregates across every `harvest_projects` row whose `project_id` is this project. When no Harvest project is pinned to this Monday project, the panel shows "No Harvest project pinned for phase-level reconciliation — see customer page for customer-wide rollup" with a link to `/customers/:id`.
- **Customer-wide reconciliation** (new) on `/customers/:id` — sums actuals across **all** the customer's `harvest_projects` (delivery + support), shown next to planned hours summed across **all** the customer's `projects`. Includes a per-Monday-project breakdown for context, plus a separate line item for hours logged on Harvest projects that aren't pinned to any Monday project (the support case).

### New UI: `/customers` index and `/customers/:id` detail

- `/customers` — sortable table of customers. Columns: name, # Monday projects, # Harvest projects, total active allocations, total Harvest hours (lifetime), and a "Linked to Harvest" badge.
- `/customers/:id` — single-customer view:
  - **Header**: customer name + Harvest-client badge + edit (PM/admin only).
  - **Monday projects** section: every `projects` row with `customer_id = :id`, linking to `/projects/:id`. Same status-chip styling as `/projects`.
  - **Harvest projects** section: every `harvest_projects` row with `customer_id = :id`. Each row: Harvest project name, is-billable badge, pinned-to-project link (or "—"), budget hours, spent hours, last-fetched.
  - **Customer-wide reconciliation** card: aggregated planned-vs-actual with the breakdown described above.
- Nav adds `Customers` between `Risks` and `Projects`.

### `/trackers` linking surfaces redesigned

- The existing project-level Harvest link table (`<HarvestLinkTable>` that ties one Torii project to one Harvest project) is **replaced** by a two-step linking flow:
  - **Step 1: Customer linking** — `<HarvestClientLinkTable>` lists Harvest clients; per-row picks a Torii customer (or "Create new customer with this name"). This is the authoritative customer ID mapping.
  - **Step 2: Per-Harvest-project pinning (optional)** — `<HarvestProjectPinTable>` lists Harvest projects whose customer is linked but `project_id` is unset; per-row picks a Torii project under that same customer (or "Leave at customer level"). Skipping is fine — the Harvest project will roll up at the customer level.
- The existing Harvest **user**-link table from #1 (Person ↔ harvest_user_id) is unchanged.

### Out of scope (deferred — called out in spec non-goals)

- **Customer-level capacity rollup** ("how much of the team is allocated across all of Acme's Monday projects this week"). The data is reachable but the UI is its own concern; this change ships customer-wide *hours*, not customer-wide *capacity*.
- **Cross-customer dashboard tiles** (e.g., "top 5 customers by burn this month"). The customer page exists, an index lists them, but the portfolio dashboard from #2 isn't restructured around customers in this change.
- **Auto-link Harvest clients by name** to Torii customers. Admin-driven only, same rationale as the no-fuzzy-matching rule for Person ↔ harvest_user_id linking.
- **Editing Harvest project names or budgets in Torii.** Harvest is the source of truth for those fields; Torii reads them.
- **Splitting Harvest project hours across multiple Torii projects.** A Harvest project belongs to at most one Torii project (the pin is 1:1). If the same Harvest project funds two phases, the modeling assumption is that someone created two Harvest projects.

## Capabilities

### Modified Capabilities

- `project-lifecycle` — Project gains an optional `customer_id` FK. The old `harvest_project_id` field is removed (link moves to the Harvest-project side).
- `harvest-integration` — adds `Customer` and `HarvestProject` entities; the cached snapshot moves from per-Torii-project to per-Harvest-project; new admin endpoints for Harvest client listing and Customer linking; existing `overBudget` derivation now sums across the customer's Harvest projects pinned to this Torii project.
- `capacity-planning` — Per-project reconciliation aggregates across pinned Harvest projects; new customer-level reconciliation endpoint.
- `dashboard-views` — Adds `/customers` index and `/customers/:id` detail; modifies the `<HarvestPanel>` and `<ReconciliationPanel>` on `/projects/:id` to reflect the many-Harvest-to-one-Torii model; nav adds Customers.

## Impact

- **New code**:
  - 2 new Prisma models (`Customer`, `HarvestProject`), 1 new FK on `Project`.
  - 4–5 new API endpoints (customer CRUD-lite, customer reconciliation, Harvest client list, customer-link).
  - 2 new web routes (`/customers`, `/customers/:id`) and 2–3 new components (`<HarvestClientLinkTable>`, `<HarvestProjectPinTable>`, customer reconciliation card).
  - Sync engine learns to upsert HarvestProject rows from the Harvest projects API as part of the existing scheduled refresh.
- **DB**: 1 new migration. Two new tables (`customers`, `harvest_projects`). One column added to `projects` (`customer_id`). One column dropped from `projects` (`harvest_project_id`). One table dropped (`project_harvest_snapshots`) with its data migrated. Indexes: `customers.harvest_client_id` unique, `harvest_projects.customer_id`, `harvest_projects.project_id`.
- **API contracts**: `/api/projects/:id` response gains a `customerId` and `customer` (resolved row). `/api/projects/:id/harvest` (existing single-snapshot endpoint) becomes **multi-snapshot** — returns an array of `harvestProjects` instead of one. `/api/projects/:id/harvest/link` and `/unlink` endpoints are removed (link moves to the Harvest-project side). New endpoints: `/api/customers`, `/api/customers/:id`, `/api/customers/:id/reconciliation`, `/api/tracker/harvest/clients`, `/api/tracker/harvest/projects/:id/pin`, `/api/tracker/harvest/projects/:id/unpin`. This is a breaking API change — the web client and any external consumers must update together.
- **Env**: no new env vars.
- **Dependencies**: no new packages.

## Non-goals

- No customer-level capacity (allocation %) rollup yet — hours only.
- No auto-linking by name. Admin chooses every link manually.
- No splitting a Harvest project across multiple Torii projects.
- No Slack / email alerts on customer-level variance.
- No retention of the legacy `projects.harvest_project_id` column post-migration. Backwards-compat shims are explicitly out (per the project's "no compat hacks" rule).
- No portfolio-dashboard restructuring around customers in this change. The dashboard from #2 keeps reading at the project level.

## Rollback plan

This is the largest schema-shape change in Torii's history. Rollback is **down-migration in three reversed steps**:

1. Recreate `project_harvest_snapshots` table.
2. Copy snapshot fields back from `harvest_projects` to `project_harvest_snapshots` for rows where `harvest_projects.project_id` is non-null (the pinned ones); orphan the rest with an admin log warning.
3. Recreate `projects.harvest_project_id` and backfill from `harvest_projects.id` where `harvest_projects.project_id IS NOT NULL`.
4. Drop `harvest_projects`, drop `projects.customer_id`, drop `customers`.

Customer-only data (un-pinned Harvest projects, support-only customers) is lost on rollback — there's no place for it in the old schema. We accept this; rollback is a worst-case path.

## Affected teams

- **PMO** — the way they think about Torii shifts. "Open this Monday project" stays the same; "Open this customer" is new and probably becomes the more useful entry point over time. Customer-wide hours are visible for the first time.
- **Finance / Engineering ops** — the support-project hours that previously had nowhere to live in Torii are now surfaced. Expect "why is this customer at 600 hours of support? what was that?" reactions on the first read.
- **Admin / IT** — one-time setup post-deploy: walk through `/trackers` → "Harvest clients" and map each Harvest client to a Torii customer. The data backfill seeds rows automatically for currently-linked projects, but any Harvest client whose Torii customer was previously unmodeled (because no Torii project was linked) will need a manual review.
