## MODIFIED Requirements

### Requirement: At-risk listing endpoint
The system SHALL expose `GET /api/risks` returning every project whose most recent `ProjectRiskUpdate` (by `weekOf` descending) has `ragLevel != Green`. The response MUST include, for each such project, the project's id, name, the most recent update's `weekOf`, `ragLevel`, `riskTypes`, `state`, a single-line title derived from the update's `description` (truncated), AND the project's `customerId` + `customerName` (both nullable when the project hasn't been mapped to a customer yet). Projects whose most recent state is `Done` (in `Project.state`) MUST be excluded. Projects with no risk updates MUST be excluded.

The endpoint accepts an optional `include=stale` query parameter that changes the response shape:

- **Without** `include=stale` (or any unrecognized value): response is `RiskListItem[]` (the existing array shape, with the new customer fields). Backwards-compatible — existing consumers (Portfolio Dashboard's "This week's risk picture") continue to work.
- **With** `include=stale`: response is `{ atRisk: RiskListItem[], stale: StaleRiskRow[] }`. `atRisk` is the same array as without the parameter. `stale` is an array of projects whose most-recent `ProjectRiskUpdate.weekOf` is more than **2 ISO weeks before** the current week's Monday (using the existing `isoWeekMondayUTC` helper), OR projects with no `ProjectRiskUpdate` rows at all. Each stale row carries `{ projectId, projectName, customerId, customerName, lastRagLevel: RagLevel | null, lastWeekOf: ISO-date | null, weeksSinceLastUpdate: number | null }`. Stale-row `null` fields appear together — a never-updated project has all three lastUpdate-derived fields null.

The `stale[]` array MUST be capped at 100 rows server-side, sorted by `weeksSinceLastUpdate` descending with nulls first (never-updated projects surface above the long-stale tail).

#### Scenario: Default response shape preserved
- **WHEN** a client reads `GET /api/risks` without query parameters
- **THEN** the response is an array of `RiskListItem` rows (with the new `customerId` / `customerName` fields populated where applicable)

#### Scenario: include=stale returns object form
- **WHEN** a client reads `GET /api/risks?include=stale`
- **THEN** the response is `{ atRisk: [...], stale: [...] }` and `atRisk` contains the same rows as the default response

#### Scenario: 2-week stale threshold
- **GIVEN** project A whose latest `ProjectRiskUpdate.weekOf` is the most recent Monday minus 14 days (exactly 2 weeks)
- **WHEN** a client reads `GET /api/risks?include=stale`
- **THEN** project A is NOT in `stale[]` (the threshold is "more than 2 weeks" — 2 weeks is fresh)

#### Scenario: 3-week stale included
- **GIVEN** project B whose latest update is 21 days before today's ISO week Monday
- **WHEN** a client reads `GET /api/risks?include=stale`
- **THEN** project B IS in `stale[]` with `weeksSinceLastUpdate >= 3`

#### Scenario: Never-updated project in stale array
- **GIVEN** project C with zero `ProjectRiskUpdate` rows and `state != Done`
- **WHEN** a client reads `GET /api/risks?include=stale`
- **THEN** project C appears in `stale[]` with `lastRagLevel = null`, `lastWeekOf = null`, `weeksSinceLastUpdate = null`

#### Scenario: Customer info on at-risk rows
- **GIVEN** project D linked to customer "Acme Corp" with a Red weekly update
- **WHEN** a client reads `GET /api/risks`
- **THEN** the row for project D includes `customerId: <Acme's id>, customerName: "Acme Corp"`

#### Scenario: Customer-unmapped project still surfaces
- **GIVEN** project E with no `customer_id` and a Red weekly update
- **WHEN** a client reads the endpoint
- **THEN** project E's row has `customerId: null, customerName: null` (the project is still listed)

### Requirement: Risks page (web)
The web app SHALL provide a `/risks` route accessible to any authenticated user that renders currently-at-risk projects (from `GET /api/risks?include=stale`) clustered under customer headers, plus a trailing "Stale updates" section.

The page MUST render:

1. **KPI tile row** at the top — same three tiles as today: At risk total, Red count, Amber count.
2. **PM-only "Update my week" button** in the page header that opens the bulk-update side panel (see "Bulk weekly update flow" below). The button is hidden when no projects need a current-week update or when the viewer is not a PM.
3. **At-risk groups** — for each customer that has at least one currently-off-Green project, a group header (customer name linking to `/customers/:id`, plus a count chip "N projects · X red · Y amber") and the list of `<RiskProjectCard>` cards beneath. Projects with `customerId = null` cluster under a trailing **"No customer"** header. Customer groups sort alphabetically by name; "No customer" always sorts last.
4. **Stale updates section** — when `stale[]` is non-empty, a section titled "Stale updates" listing each stale row: project name (link to `/projects/:id`), customer (link or em-dash), last RAG + week (em-dash when null), `weeksSinceLastUpdate` chip ("never" when null), and a PM-only "Update now" button. Sorted by `weeksSinceLastUpdate` descending with nulls first. Hidden entirely when `stale[]` is empty.

Each `<RiskProjectCard>` MUST display:

- The project name in the card header (linking to `/projects/:id`).
- A **RAG chip** (Red / Amber / Green palette) showing the current `ragLevel`.
- A **trend chip** next to the RAG. Computed client-side from the project's history (the per-card `GET /api/projects/:id/risk-updates` fetch already in place):
  - "New" when no prior `ProjectRiskUpdate` exists.
  - "Returned from Green" when the previous week's update was Green and the current week is non-Green.
  - "Same" when `current.ragLevel === previous.ragLevel`.
  - "↑ Worsened from <prev>" when the current level is worse (severity: Green < Amber < Red).
  - "↓ Improved from <prev>" when the current level is better.
- A **weeks-stuck chip** rendered ONLY when the project has been at the same non-Green `ragLevel` for ≥2 consecutive weeks (walking history backward from the current week). Text: "Stuck N weeks at <level>". Hidden when N < 2.
- A **risk-type tag list** (Technical / Schedule / etc.) and **state badge** (Blocked / Inform).
- A **2-column label/value table** with these four rows:
  1. **Description / History** — top: `description` field (the standing situation). Below: a small "This week:" label followed by the `latestUpdate` text. Below that: a disclosure labeled "View N earlier weeks" that expands to render every prior `ProjectRiskUpdate` (newest first), each carrying its own copy of the same field set in the same 2-column layout.
  2. **Go-to-green plan** — the `goToGreenPlan` field.
  3. **Next steps** — the `nextSteps` field.
  4. **Action Requested** — the `actionRequested` field.

For PM users, the card MUST include an "Edit this week" action that opens an inline form to upsert that week's update via `POST /api/projects/:id/risk-updates`. The form's fields and labels match the read-mode table rows (the user sees the same shape during and after editing).

#### Scenario: Customer-grouped layout
- **GIVEN** three at-risk projects: two under customer "Acme" and one under customer "Beta"
- **WHEN** an authenticated user opens `/risks`
- **THEN** the page renders two customer headers ("Acme" with count chip "2 projects · …", "Beta" with "1 project · …"); the cards sit under their respective headers

#### Scenario: Unmapped projects trail under "No customer"
- **GIVEN** one at-risk project with `customerId = null` and two under named customers
- **WHEN** the page renders
- **THEN** the named-customer groups appear first; the unmapped project appears under a trailing "No customer" header

#### Scenario: Trend chip "Returned from Green"
- **GIVEN** project A whose previous week's `ProjectRiskUpdate.ragLevel` was Green and current week is Amber
- **WHEN** the card renders
- **THEN** the trend chip reads "Returned from Green"

#### Scenario: Trend chip "Worsened"
- **GIVEN** project A whose previous week was Amber and current week is Red
- **WHEN** the card renders
- **THEN** the trend chip reads "↑ Worsened from Amber"

#### Scenario: Weeks-stuck chip hidden at 1 week
- **GIVEN** project A whose previous week was Green and current week is Red (1-week-old red)
- **WHEN** the card renders
- **THEN** the weeks-stuck chip is NOT rendered

#### Scenario: Weeks-stuck chip surfaces at 3 weeks
- **GIVEN** project A whose three most recent weekly updates are all Red
- **WHEN** the card renders
- **THEN** the weeks-stuck chip reads "Stuck 3 weeks at Red"

#### Scenario: Card details render as 4-row table
- **GIVEN** an at-risk project with all five free-text fields populated
- **WHEN** the card renders
- **THEN** four rows render: Description / History (containing description + "This week:" + latestUpdate + history disclosure), Go-to-green plan, Next steps, Action Requested

#### Scenario: Stale section hidden when empty
- **GIVEN** no projects meet the stale threshold
- **WHEN** the page renders
- **THEN** the "Stale updates" section is absent (no empty-state placeholder)

#### Scenario: Non-PM doesn't see edit affordances
- **GIVEN** an authenticated user with role `Viewer`
- **WHEN** the page renders
- **THEN** no "Update my week" button is shown; cards have no "Edit this week" action; "Update now" buttons in the stale section are absent

## ADDED Requirements

### Requirement: Bulk weekly update flow
The system SHALL provide a PM-only flow for updating the current ISO week's `ProjectRiskUpdate` for every project the viewer is associated with that doesn't yet have a current-week update.

**API**: `GET /api/risks/my-week` — accessible to PM users only (403 otherwise). Returns an array of projects where the viewer matches `ownerId`, `projectManagerId`, `solutionArchitectId`, or `solutionConsultantId`, AND no `ProjectRiskUpdate` exists with `weekOf === isoWeekMondayUTC(today)`. Each row: `{ projectId, projectName, projectPhase, projectState, customerId, customerName }`.

**UI**: a side panel opened from the "Update my week" button on `/risks`. The panel renders one row per project from `/api/risks/my-week`, each containing:

- Project name + phase chip + (when set) a customer link.
- An inline RAG selector (Red / Amber / Green); defaults to Green.
- An inline state selector (Blocked / Inform); enabled only when RAG is non-Green.
- A single-line `latestUpdate` text input.
- A single-line `nextSteps` text input.

A "Save all" button at the bottom of the panel POSTs each row sequentially to `POST /api/projects/:id/risk-updates`. Rows that save successfully MUST disappear from the panel. Rows that fail MUST stay visible with the failure message inline. Closing the panel after one or more successful saves MUST invalidate the `/api/risks` cache so the main page reflects the updates.

Empty state when zero projects need updating: a single line "You're caught up for this week." with a Close button.

#### Scenario: Bulk panel lists missing current-week updates
- **GIVEN** PM Aaron with 5 projects, 3 of which already have a current-week update
- **WHEN** Aaron clicks "Update my week" on `/risks`
- **THEN** the side panel shows 2 rows (the 2 projects without a current-week update)

#### Scenario: Successful save removes the row
- **GIVEN** the panel is open with 2 rows
- **WHEN** Aaron fills RAG=Green on both rows and clicks "Save all"
- **THEN** both rows disappear from the panel after a successful POST to each project; the main `/risks` page invalidates and re-renders without those projects in the stale section

#### Scenario: Partial-save error stays visible
- **GIVEN** the panel is open with 3 rows; saving the 2nd row 500s
- **WHEN** Aaron clicks "Save all"
- **THEN** rows 1 and 3 disappear; row 2 remains visible with the error message inline; the panel does not auto-close

#### Scenario: Non-PM cannot open the panel
- **GIVEN** an authenticated user with role `Viewer`
- **WHEN** they navigate to `/risks`
- **THEN** the "Update my week" button is not rendered; calling `GET /api/risks/my-week` directly returns 403

#### Scenario: Default RAG is Green
- **GIVEN** the panel opens with one row for a project with no current update
- **WHEN** the row first renders
- **THEN** the RAG selector defaults to Green and the state selector is disabled (Green has no Blocked/Inform sub-state)

#### Scenario: Empty state when caught up
- **GIVEN** PM Aaron has already filed updates for every project he holds a role on
- **WHEN** he clicks "Update my week"
- **THEN** the panel reads "You're caught up for this week." with a Close button
