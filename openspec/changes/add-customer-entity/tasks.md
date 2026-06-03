## 1. Prisma schema + migration

- [x] 1.1 Add `Customer` model to `apps/api/prisma/schema.prisma`: `id` cuid, `name`, `harvestClientId String? @unique @map("harvest_client_id")`, timestamps. Relations: `projects: Project[]`, `harvestProjects: HarvestProject[]`.
- [x] 1.2 Add `HarvestProject` model: `id String @id` (Harvest's project ID as text), `name`, `customerId String @map("customer_id")` (FK, NOT NULL), `projectId String? @map("project_id")` (FK, nullable), `isBillable Boolean @default(true) @map("is_billable")`, plus snapshot fields `budgetHours Decimal? @db.Decimal(10,2) @map("budget_hours")`, `spentHoursBillable Decimal @default(0) @db.Decimal(10,2) @map("spent_hours_billable")`, `spentHoursNonbillable Decimal @default(0) @db.Decimal(10,2) @map("spent_hours_nonbillable")`, `breakdown Json @default("[]")`, `fetchedAt DateTime @default(now()) @map("fetched_at")`, `harvestProjectUrl String @map("harvest_project_url")`, `raw Json?`. Indexes: `@@index([customerId])`, `@@index([projectId])`.
- [x] 1.3 Add `Project.customerId String? @map("customer_id")` and the `customer Customer?` relation. Remove `Project.harvestProjectId` field, the `@@unique([harvestProjectId])` constraint, and the `harvestSnapshot ProjectHarvestSnapshot?` relation. Update existing relation declarations in `Person` and elsewhere as needed (none should reference the removed fields).
- [x] 1.4 Drop the `ProjectHarvestSnapshot` model from `schema.prisma` (the table is replaced by `HarvestProject`).
- [x] 1.5 Run `pnpm --filter @torii/api exec prisma migrate dev --name add_customer_and_harvest_project_entities` and review the generated SQL.
- [x] 1.6 Edit the generated migration to add an inline backfill block between schema steps:
  - Insert distinct customers from `project_harvest_snapshots.raw -> 'client'`, keyed by `harvest_client_id`.
  - Insert `harvest_projects` rows from each snapshot row, copying snapshot fields, setting `customer_id` from the matching customer, and setting `project_id` to the snapshot's `project_id`. Read the Harvest project's `name`, `is_billable`, and `url` from `raw`.
  - Update `projects.customer_id` from the joined customer.
  - Verify no `project_harvest_snapshots` row is silently dropped: count before vs. `harvest_projects` count after must match.
  - Then run the destructive steps (drop `projects.harvest_project_id`, drop `project_harvest_snapshots`).
- [x] 1.7 Smoke-test the migration locally by snapshotting the DB pre-migration, running it, and verifying counts and a sample row.

## 2. API: HarvestProject sync ingest

- [x] 2.1 In `apps/api/src/sync/harvest/HarvestAdapter.ts`, add `listProjects()` returning `Array<{ id, name, clientId, clientName, isBillable, url }>` from `GET /v2/projects?is_active=true&per_page=100` with paging. Mirrors the existing `listUsers()` shape.
- [x] 2.2 Add `listClients()` returning `Array<{ id, name }>` from `GET /v2/clients?is_active=true`.
- [x] 2.3 In the existing Harvest scheduled-refresh job, after fetching per-project snapshots, also: pull `listClients()`, upsert any new clients into `customers` rows whose `harvest_client_id` matches (existing customers left untouched); pull `listProjects()`, upsert into `harvest_projects` matching by `id`, attaching to the customer via `harvest_client_id`. Leave `project_id` (the pin) unchanged on upsert — admin owns that field.
- [x] 2.4 The per-Harvest-project snapshot data (budget / spent / breakdown) continues to be fetched per-project via the existing single-project refresh and written to the `harvest_projects` row (not the dropped snapshot table).

## 3. API: customer endpoints

- [x] 3.1 New module `apps/api/src/routes/customers.ts` exporting `registerCustomerRoutes({ db })`.
- [x] 3.2 `GET /api/customers` — list every customer with derived counts: `mondayProjectCount`, `harvestProjectCount`, `lifetimeHours` (sum across linked `harvest_projects`). Auth: any user.
- [x] 3.3 `GET /api/customers/:id` — single customer with resolved Monday projects (full project shape) and resolved Harvest projects (full `harvest_projects` shape, hours-only — never expose `raw` to non-admins). Auth: any user.
- [x] 3.4 `POST /api/customers` body `{ name, harvestClientId? }` — create. Auth: PM or admin. Reject if `harvestClientId` already taken.
- [x] 3.5 `PATCH /api/customers/:id` body `{ name?, harvestClientId? }` — rename / link to a Harvest client. Auth: PM or admin.
- [x] 3.6 `GET /api/customers/:id/reconciliation` — per-customer reconciliation. Response: `{ plannedHours, actualHours, supportHours, varianceHours, variancePct, perProject: Array<{ projectId, projectName, plannedHours, actualHours, varianceHours, variancePct, linkedHarvestProjectIds: string[] }> }`. Auth: any user.
- [x] 3.7 Register the new module in `apps/api/src/app.ts`.

## 4. API: tracker linking endpoints

- [x] 4.1 `GET /api/tracker/harvest/clients` — admin-only. Returns `Array<{ harvestClientId, name, linkedToiriCustomerId: string | null, linkedToiriCustomerName: string | null }>`. Source: live Harvest clients via `listClients()`, joined to local `customers` rows.
- [x] 4.2 `POST /api/customers/:id/harvest-link` body `{ harvestClientId }` — admin-only. Sets `customers.harvest_client_id`. Fails if the client ID is already linked to another customer.
- [x] 4.3 `DELETE /api/customers/:id/harvest-link` — admin-only. Unsets `customers.harvest_client_id`.
- [x] 4.4 `POST /api/tracker/harvest/projects/:harvestProjectId/pin` body `{ toriiProjectId }` — admin-only. Sets `harvest_projects.project_id`. Validates that the Torii project's `customer_id` matches the Harvest project's `customer_id`.
- [x] 4.5 `DELETE /api/tracker/harvest/projects/:harvestProjectId/pin` — admin-only. Clears `harvest_projects.project_id`.
- [x] 4.6 Remove the old `/api/projects/:id/harvest/link` and `/unlink` endpoints from `apps/api/src/routes/harvest-projects.ts` — replaced by the per-Harvest-project pin endpoints above.

## 5. API: existing project endpoints adapt to multi-snapshot

- [x] 5.1 In `serializeProject` (`apps/api/src/routes/projects.ts`), expose `customerId` and `customer: { id, name } | null` (resolved when included). Remove `harvestProjectId` from the response shape. `overBudget` now sums `budgetHours` and `spentHours*` across all `harvest_projects` with matching `project_id`.
- [x] 5.2 `GET /api/projects/:id/harvest` — change response from `HarvestSnapshot` to `{ harvestProjects: HarvestProjectSnapshot[] }`. Each `HarvestProjectSnapshot` is the new row shape (id, name, isBillable, budgetHours, spentHoursBillable, spentHoursNonbillable, breakdown, fetchedAt, harvestProjectUrl). Order: pinned-and-billable first, then by name.
- [x] 5.3 `POST /api/projects/:id/harvest/refresh` — refresh all `harvest_projects` rows pinned to this project (in parallel). Returns the refreshed `harvestProjects` array.
- [x] 5.4 Per-project reconciliation endpoint (existing `GET /api/people/:id/reconciliation` from #1) — `actualHours` per project now sums across pinned Harvest projects via `harvest_projects.project_id`. No response-shape change.

## 6. Shared schemas

- [x] 6.1 Add `CustomerSchema` and `CustomerOutSchema` to `packages/shared/src/schemas.ts`.
- [x] 6.2 Add `HarvestProjectSnapshotSchema` mirroring the new row shape (strict, no monetary keys — same defense-in-depth as the existing `HarvestSnapshotSchema`).
- [x] 6.3 Add `CustomerReconciliationSchema` for `GET /api/customers/:id/reconciliation`.
- [x] 6.4 Update existing `ProjectOutSchema` to add `customerId` / `customer` and drop `harvestProjectId`.
- [x] 6.5 Update existing `HarvestSnapshotSchema` to either rename to `HarvestProjectSnapshotSchema` (preferred) or deprecate. Verify no internal consumer relies on the old shape outside `harvest-projects.ts`.

## 7. Web: API client

- [x] 7.1 In `apps/web/src/api/endpoints.ts`: add `Customer`, `CustomerDetail`, `HarvestProjectSnapshot`, `CustomerReconciliation`, `HarvestClientListItem` types and helper functions: `listCustomers`, `getCustomer`, `createCustomer`, `updateCustomer`, `customerReconciliation`, `listHarvestClients`, `linkCustomerToHarvestClient`, `unlinkCustomerHarvestClient`, `pinHarvestProject`, `unpinHarvestProject`.
- [x] 7.2 Update `getHarvestSnapshot` to return `{ harvestProjects: HarvestProjectSnapshot[] }`. Rename `refreshHarvestSnapshot` accordingly. Remove `linkHarvestProject` and `unlinkHarvestProject` (project-level link is gone).
- [x] 7.3 Update `Project` type: add `customerId: string | null` and `customer: { id: string; name: string } | null`. Remove `harvestProjectId`.

## 8. Web: customer pages

- [x] 8.1 New `apps/web/src/routes/customers-list.tsx` exporting `<CustomersListPage>`. Sortable table: name (link → `/customers/:id`), # Monday projects, # Harvest projects, lifetime hours, "Linked to Harvest" badge.
- [x] 8.2 New `apps/web/src/routes/customer-detail.tsx` exporting `<CustomerDetailPage>` at `/customers/:id`:
  - Header card: customer name + Harvest-link badge + (PM/admin only) edit name affordance.
  - Section: Monday projects (table of full project rows linking to `/projects/:id`).
  - Section: Harvest projects (table: name, is-billable, pinned-to, budget, spent, last-fetched).
  - Section: Customer-wide reconciliation card — total planned vs. actual, with support-hours line item and per-Monday-project breakdown.
- [x] 8.3 Register both routes in `App.tsx`.

## 9. Web: existing pages adapt

- [x] 9.1 `<HarvestPanel>` (`apps/web/src/components/HarvestPanel.tsx`) — redraw as N panels (one per pinned Harvest project) under a "Linked Harvest projects" heading. Empty state when no Harvest project is pinned to this Torii project: "No Harvest project pinned for phase-level reconciliation. See the customer page for customer-wide rollup." with a link to `/customers/:id`.
- [x] 9.2 `<ReconciliationPanel>` (`apps/web/src/components/ReconciliationPanel.tsx`) — per-person actuals now come from the summed-across-pinned-Harvest-projects total. Render unchanged otherwise.
- [x] 9.3 Project detail page (`apps/web/src/routes/project-detail.tsx`) — add a "Customer: <name>" link in the header facets band when `customerId` is set; render `—` otherwise. Link to `/customers/:id`.
- [ ] 9.4 Projects list (`apps/web/src/routes/projects-list.tsx`) — add an optional Customer column (hidden by default in the column control). Sortable.

## 10. Web: /trackers redesign

- [x] 10.1 In `apps/web/src/routes/trackers.tsx`, replace the existing `<HarvestLinkTable>` (project-level) with two new tables under a "Harvest setup" section:
  - `<HarvestClientLinkTable>`: one row per Harvest client, dropdown to pick a Torii customer (or "Create new customer with this name"). Submitting calls `linkCustomerToHarvestClient` (after creating the customer if needed).
  - `<HarvestProjectPinTable>`: one row per Harvest project whose customer is linked. Dropdown picks a Torii project under that same customer (or "Leave at customer level"). Submitting calls `pinHarvestProject` / `unpinHarvestProject`.
- [x] 10.2 Keep `<HarvestUserLinkTable>` (Person ↔ harvest_user_id) unchanged — it's orthogonal.

## 11. Web: nav + breadcrumbs

- [x] 11.1 In `NavShell.tsx`, add `<NavLink to="/customers">Customers</NavLink>` between Risks and Projects. Visible to every authenticated user.
- [x] 11.2 Update the breadcrumb label switch to include `/customers` → "Customers" and `/customers/:id` → "Customer detail".

## 12. CSS

- [x] 12.1 Reuse `kpi-row` / `kpi` classes for the customer-page top row (project count, Harvest project count, lifetime hours, variance).
- [x] 12.2 Add `.customer-harvest-row` for the per-Harvest-project sub-rows in the project page HarvestPanel multi-snapshot view.
- [x] 12.3 Reuse `.variance-chip-*` classes for the customer-wide reconciliation card.

## 13. Spec deltas

- [x] 13.1 `project-lifecycle` — modify the Project entity requirement to add `customer_id` FK and remove `harvest_project_id`. Modify the `overBudget` derivation requirement to sum across pinned Harvest projects.
- [x] 13.2 `harvest-integration` — add Customer + HarvestProject entity requirements, modify the cached snapshot requirement (now per-Harvest-project, not per-Torii-project), modify the HarvestPanel requirement (multi-snapshot), add the Harvest client listing + customer-link endpoints, modify the per-project link requirement (now optional pin on the Harvest-project side).
- [x] 13.3 `capacity-planning` — add the customer-level reconciliation endpoint requirement.
- [x] 13.4 `dashboard-views` — add the `/customers` index and `/customers/:id` requirements, modify the Navigation shell requirement (Customers added between Risks and Projects).

## 14. Verification

- [x] 14.1 `pnpm --filter @torii/api test` green. Existing snapshot/link tests adapted to the new shape.
- [x] 14.2 `pnpm --filter @torii/web exec tsc --noEmit` clean.
- [x] 14.3 `pnpm --filter @torii/web build` succeeds.
- [ ] 14.4 Manually: run the migration against a copy of prod data; verify all previously-linked projects show their HarvestPanel correctly post-migration.
- [ ] 14.5 Manually: create a test customer with two Monday projects and one support Harvest project; verify the customer page rolls up correctly.
- [ ] 14.6 Manually: pin a Harvest project to a specific Monday project via `/trackers`; verify the project's HarvestPanel and ReconciliationPanel reflect the link.
- [ ] 14.7 Manually: a previously-unlinked Torii project remains visible at `/projects/:id` with "Customer: —" and the HarvestPanel's "no Harvest project pinned" empty state.
- [ ] 14.8 Manually: the `/customers` index sorts correctly by each column and links through to detail.
- [ ] 14.9 Manually: a non-admin can read `/customers` and `/customers/:id` but does not see the Trackers link or the linking surfaces on `/trackers`.
- [ ] 14.10 Manually: confirm the nav "Customers" link is between Risks and Projects.
