## ADDED Requirements

### Requirement: Per-project Allocations vs. Actuals panel
The project detail page SHALL render a `<ReconciliationPanel>` section card below the existing AllocationsPanel. The panel is visible to every authenticated user (read-only — no edit affordances).

The panel MUST render a table with one row per Person allocated to this project (via the existing `allocations` table). Each row displays:

- **Person name** (linked to `/people/:id` when the FK resolves; falls back to allocation's `personId` otherwise)
- **Planned hours** — the sum of `plannedHoursForAllocation` across every allocation this Person has on this project
- **Actual hours** — total from the project's Harvest snapshot breakdown, summing all `tasks[].people[]` entries where `people[i].personId === person.harvest_user_id`. Renders "no Harvest link" when the Person has no `harvest_user_id` set.
- **Variance** — signed hours and signed percentage; null when actuals are null
- **Status chip** — green/amber/red per `varianceBucket(planned, actual)`; neutral "no Harvest link" chip when actuals are null

Below the main table, a collapsible `<details>` titled "Logged but not allocated" MUST list every Person from the Harvest snapshot breakdown whose `harvest_user_id` doesn't match any allocated Person on this project. This surfaces the inverse error case — work logged without a corresponding allocation. Each "Logged but not allocated" row shows the Person's name (linked when resolvable) and their actual hours.

When the project has no allocations, the panel renders "No allocations on this project." When the project has no Harvest snapshot, the panel renders "No Harvest snapshot — refresh the project to populate actuals." When the project has allocations but no allocated Person is linked to a Harvest user, the panel renders the planned-hours column with "no Harvest link" chips and a one-line CTA "Link Torii People to Harvest users at /trackers".

#### Scenario: All allocated people are linked
- **GIVEN** a project with 3 allocations whose People all have `harvest_user_id` set, and a Harvest snapshot
- **WHEN** the page renders
- **THEN** the panel shows 3 rows with planned and actual hours; variance chips reflect the buckets

#### Scenario: One person unlinked
- **GIVEN** the same project but one allocated Person has no `harvest_user_id`
- **WHEN** the page renders
- **THEN** that person's row shows the planned hours and a "no Harvest link" neutral chip in place of actuals; the other two rows render normally

#### Scenario: Logged-but-not-allocated surfaces invisible work
- **GIVEN** the Harvest snapshot includes a developer's hours, and that developer has a linked Torii Person, but is NOT in the project's `allocations`
- **WHEN** the page renders
- **THEN** the developer appears in the "Logged but not allocated" disclosure with their actual hours

#### Scenario: No allocations
- **GIVEN** a project with zero `allocations` rows
- **WHEN** the page renders
- **THEN** the panel renders "No allocations on this project."

#### Scenario: No Harvest snapshot
- **GIVEN** a project with allocations but no `project_harvest_snapshots` row (not yet refreshed, or no Harvest link)
- **WHEN** the page renders
- **THEN** the panel renders "No Harvest snapshot — refresh the project to populate actuals." with a link affordance to the HarvestPanel's refresh button

### Requirement: Per-person Allocations vs. Actuals section on /people/:id
The `/people/:id` view SHALL render an "Allocations vs. Actuals" section below the existing role sections. The section is hidden entirely when the Person has no allocations AND no `harvest_user_id` (nothing to show).

The section MUST fetch `GET /api/people/:id/reconciliation` and render a table: Project name (link) | Planned | Actual | Variance | Status chip. Same color-coded variance chip rules as the per-project panel. The "no Harvest link" state renders when the Person's `harvest_user_id` is null; the table still shows planned hours per project, just without actuals or variance.

#### Scenario: Linked person with allocations on 3 projects
- **GIVEN** a Person linked to a Harvest user, with allocations on 3 projects
- **WHEN** they open `/people/:id`
- **THEN** the Allocations vs. Actuals section shows 3 rows with planned + actual + variance

#### Scenario: Unlinked person
- **GIVEN** a Person with allocations on projects but no `harvest_user_id`
- **WHEN** the page renders
- **THEN** every row shows planned hours; the Actual / Variance columns show null; the status chip is "no Harvest link" neutral

#### Scenario: Person with no allocations and no Harvest link
- **GIVEN** a Person with neither allocations nor a Harvest user link
- **WHEN** the page renders
- **THEN** the Allocations vs. Actuals section is hidden entirely (not rendered at all, no empty card)
