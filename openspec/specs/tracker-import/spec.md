# tracker-import Specification

## Purpose
TBD - created by archiving change add-integration-dashboard. Update Purpose after archive.
## Requirements
### Requirement: Tracker adapter interface
The system SHALL define a `TrackerAdapter` interface in `packages/shared` with the methods: `listProjects()`, `getProject(externalId)`, `getMetadata()`, and `verifyAccess()`. Every concrete adapter MUST implement this interface. The interface MUST be the only contract between the sync engine and concrete providers.

Adapters MAY expose additional provider-specific methods (e.g., `HarvestAdapter.getProjectSnapshot()`) for capabilities that do not fit the generic interface. Provider-specific methods MUST NOT be called from the merge engine; they are intended for capability-specific code paths.

#### Scenario: Adapter registration
- **GIVEN** a new adapter registered at startup under provider key `"harvest"`
- **WHEN** the sync engine is asked to sync a TrackerConnection with `provider="harvest"`
- **THEN** the engine resolves the adapter from the registry and invokes interface methods through the interface, never through provider-specific code

#### Scenario: Provider-specific method invocation
- **GIVEN** a HarvestAdapter registered under `"harvest"`
- **WHEN** a route handler needs the project budget snapshot
- **THEN** the handler resolves the adapter and casts to its concrete type to call `getProjectSnapshot()`; the merge engine remains unaware of this method

### Requirement: Monday.com adapter
The system SHALL ship a Monday.com adapter that implements `TrackerAdapter` using Monday.com's GraphQL API. It MUST support OAuth 2.0 authorization and read-only access to boards. Token storage MUST be encrypted at rest.

#### Scenario: Connect a Monday.com workspace
- **GIVEN** an admin starts the Monday.com connection flow
- **WHEN** they complete the OAuth consent and the callback returns
- **THEN** the system persists a `TrackerConnection` with `provider="monday"`, encrypts the access token, and verifies the connection by calling `getMetadata()`

#### Scenario: Surface API failure during sync
- **GIVEN** a Monday.com connection whose access token has been revoked
- **WHEN** the next sync runs
- **THEN** the system marks the connection as `status="auth_failed"`, halts further sync attempts, and surfaces the error in the admin UI

### Requirement: Project mapping
The system SHALL allow a Torii Project to be linked to exactly one Monday.com board item via `tracker_ref = {provider, external_id}`. Importing a board item MUST create a Torii Project if no link exists; subsequent imports for the same `external_id` MUST update the existing Project, not create a duplicate.

#### Scenario: Initial import creates the project
- **GIVEN** a Monday.com connection with no prior imports
- **WHEN** an admin imports board item `12345`
- **THEN** the system creates a new Torii Project with `tracker_ref={provider:"monday",external_id:"12345"}`

#### Scenario: Re-import updates rather than duplicates
- **GIVEN** a Torii Project already linked to Monday.com item `12345`
- **WHEN** sync runs again for the same item
- **THEN** the existing Torii Project is updated and no duplicate is created

### Requirement: Field ownership
The system SHALL store a per-Project `field_mapping` declaring, for each tracked field, whether `torii` or `monday` is the owner. During sync, the system MUST update only fields whose owner is `monday`. Fields owned by `torii` MUST be preserved exactly. The default mapping MUST be: `name`, `phase` (sourced from the Monday "Project Phase" status column), and the Monday-sourced `details.*` fields (`details.project_manager`, `details.solution_architect`, `details.solution_consultant`, `details.core_solution`, `details.core_vendor`, `details.status_report_url`, `details.jira_project_url`, `details.customer_type`, `details.finance_use_case`, `details.use_case_group`, `details.customer_status`) owned by `monday`; every Monday-sourced key date (`key_dates.kickoff`, `key_dates.project_start`, `key_dates.uat_start`, `key_dates.baseline_go_live`, `key_dates.target_go_live`, `key_dates.actual_go_live`) owned by `monday`; `state`, `key_dates.hypercare_end` (no Monday source), `details.primary_contact` (no Monday source), and all allocations owned by `torii`. Per-key ownership applies — the merge engine MUST iterate `keyDates` entries and apply each independently.

#### Scenario: Sync updates Monday-owned phase
- **GIVEN** a linked project with default `field_mapping` whose current phase is `Development` and a Monday item whose "Project Phase" column resolves to `UAT`
- **WHEN** sync runs
- **THEN** the Torii project's `phase` is updated to `UAT`

#### Scenario: Per-project torii override pins phase locally
- **GIVEN** a linked project whose `field_mapping.phase` is `torii` and current phase is `UAT`
- **WHEN** sync runs and Monday.com reports a phase of `Development`
- **THEN** the Torii project's phase remains `UAT`

#### Scenario: Sync updates Monday-owned name
- **GIVEN** a linked project whose `field_mapping.name` is `monday`
- **WHEN** sync runs and the Monday.com item name has changed
- **THEN** the Torii project's name is updated to match

#### Scenario: Sync updates a Monday-owned details field
- **GIVEN** a linked project whose `field_mapping."details.banking_core"` is `monday`
- **WHEN** sync runs and the Monday board's "Banking Core" column value has changed
- **THEN** the Torii project's `details.banking_core` is updated to match

#### Scenario: Sync preserves a PM-overridden details field
- **GIVEN** a linked project whose `field_mapping."details.primary_contact"` is `torii` and a PM-set value
- **WHEN** sync runs and the Monday board reports a different primary contact
- **THEN** the Torii project's `details.primary_contact` is left unchanged

#### Scenario: Sync applies multiple Monday-owned key dates in one patch
- **GIVEN** a linked project with default `field_mapping` and a Monday item exposing `Project Add Date`, `Project Start Date`, `UAT Start Date`, `Expected Go-Live Date`, and `Actual Go-Live Date`
- **WHEN** sync runs
- **THEN** the Torii project's `key_dates` map is updated with `kickoff` (← Project Add Date), `project_start` (← Project Start Date), `uat_start`, `target_go_live`, and `actual_go_live` set from the Monday values

#### Scenario: Per-key torii override on one key date does not block the others
- **GIVEN** a linked project whose `field_mapping."key_dates.target_go_live"` is `torii` and a Monday item exposing both `Expected Go-Live Date` and `Project Add Date`
- **WHEN** sync runs
- **THEN** `target_go_live` is unchanged but `kickoff` is updated from the Monday value

### Requirement: Monday adapter extracts the project phase
The Monday.com adapter SHALL populate an optional `phase` field on the `ExternalProject` it returns by reading the column titled `Project Phase`. Resolution order MUST be: (1) if the cell value contains a leading `[N]` bracket prefix, take `N` as a 1-based index into the Torii `PHASES` ordering (`[1]`→`Backlog`, `[2]`→`Initiation`, … `[7]`→`Production`); (2) otherwise compare the value (stripped of any bracket prefix) against each phase's display label case-insensitively (`Go-Live Readiness` ↔ `GoLiveReadiness`); (3) if neither matches, omit `phase` from the result — the adapter MUST NOT guess.

The default `field_mapping` MUST set `phase` to `monday` so the value is applied on sync. A per-project `field_mapping.phase = 'torii'` MUST suppress the update so PMs can pin the phase locally.

#### Scenario: Bracketed phase label resolves by index
- **GIVEN** a Monday item whose "Project Phase" column value is `[4] Development`
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** the result includes `phase = "Development"`

#### Scenario: Phase label without bracket resolves by display name
- **GIVEN** a Monday item whose "Project Phase" column value is `Go-Live Readiness` (no bracket prefix)
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** the result includes `phase = "GoLiveReadiness"`

#### Scenario: Unrecognized phase label is omitted
- **GIVEN** a Monday item whose "Project Phase" column value is `Some Unknown Label`
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `phase` is absent on the result; sync MUST NOT overwrite the existing phase

#### Scenario: Missing "Project Phase" column is omitted
- **GIVEN** a Monday item that has no "Project Phase" column
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `phase` is absent on the result

### Requirement: Monday adapter extracts key-date columns
The Monday.com adapter SHALL populate an optional `keyDates` map on the `ExternalProject` it returns by matching a fixed, documented set of Monday board-column titles to `keyDates.*` keys: "Project Add Date"→`kickoff` (PMO intake — the kickoff event), "Project Start Date"→`project_start` (start of active delivery work, distinct from kickoff), "UAT Start Date"→`uat_start`, "Baseline Go-live"→`baseline_go_live`, "Expected Go-Live Date"→`target_go_live`, "Actual Go-Live Date"→`actual_go_live`.

For each mapped column the value MUST be a yyyy-mm-dd ISO date taken from the column's `text` when present, otherwise parsed from the column's JSON-encoded `value.date`. Columns whose titles are not in the map MUST be ignored for `keyDates`. Empty values MUST be omitted. There MUST be no mapping for `hypercare_end` — it has no Monday source and remains Torii-derived.

#### Scenario: Recognized date column maps to a keyDates key
- **GIVEN** a Monday item with a column titled "Expected Go-Live Date" whose text is "2026-09-01"
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** the result includes `keyDates.target_go_live = "2026-09-01"`

#### Scenario: Every recognized date column is extracted in one pass
- **GIVEN** a Monday item with all six date columns populated
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `keyDates` contains entries for `kickoff`, `project_start`, `uat_start`, `baseline_go_live`, `target_go_live`, and `actual_go_live`

#### Scenario: Date column with empty text and a JSON value
- **GIVEN** a Monday item whose "Expected Go-Live Date" column has empty text and value `{"date":"2026-10-15"}`
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `keyDates.target_go_live` equals `"2026-10-15"`

#### Scenario: Unrecognized date column is ignored for keyDates
- **GIVEN** a Monday item with a column titled "Some Other Date"
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** no `keyDates` entry is created for it (the raw payload still preserves it via `tracker_raw`)

#### Scenario: Item with no recognized date columns yields no keyDates
- **GIVEN** a Monday item with only non-date columns
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `keyDates` is absent on the result (not an empty object)

### Requirement: Sync triggers
The system SHALL support two sync triggers: (1) a scheduled background job that runs every 30 minutes per active TrackerConnection, and (2) an on-demand "Refresh" action that an admin or PM MAY invoke from the UI for a single project or for an entire connection.

#### Scenario: Scheduled sync runs
- **GIVEN** a healthy TrackerConnection
- **WHEN** 30 minutes have elapsed since the last sync
- **THEN** the system performs a sync and records `last_synced_at` on the connection

#### Scenario: On-demand refresh of a single project
- **WHEN** a PM clicks "Refresh" on a project detail page
- **THEN** the system performs a sync for only that project's `tracker_ref` and updates its Monday-owned fields

### Requirement: Persist last-synced tracker payload per project

The system SHALL persist the full external item payload (e.g., the Monday item with its `id`, `name`, and `column_values`) on the linked Torii Project after every successful per-item fetch. The payload MUST be stored as nullable JSON on the Project (e.g., `projects.tracker_raw`) and MUST be overwritten on each subsequent successful fetch so it always represents the most recent sync. The payload is informational only and MUST NOT be consulted by the merge logic that determines which fields the tracker owns.

#### Scenario: First import populates the snapshot
- **GIVEN** an admin imports Monday item `12345` for the first time
- **WHEN** the adapter returns the item with `column_values`
- **THEN** the new Torii Project row has `tracker_raw` set to the full Monday payload

#### Scenario: Subsequent sync overwrites the snapshot
- **GIVEN** a linked Torii Project whose `tracker_raw` reflects yesterday's Monday state
- **WHEN** sync runs today and the adapter returns the item with updated column values
- **THEN** `tracker_raw` is replaced with today's payload (no merging, no append)

#### Scenario: Snapshot is refreshed even when no field-mapped change occurred
- **GIVEN** a linked Torii Project whose `field_mapping.name` is `torii`
- **WHEN** sync runs and the Monday item name has changed but Torii owns `name`
- **THEN** the Torii project's `name` is NOT updated but `tracker_raw` IS refreshed to reflect the latest Monday payload

#### Scenario: Force-mode refresh updates the snapshot per item
- **GIVEN** a PM clicks Sync Now on the trackers page (force mode)
- **WHEN** the engine iterates each linked project and calls `adapter.getProject(externalId)` per item
- **THEN** each project's `tracker_raw` is updated with the freshly fetched payload, and items where the adapter throws a per-item error retain their previous `tracker_raw` value

#### Scenario: Adapter returns null leaves the snapshot intact
- **GIVEN** a linked Torii Project with an existing `tracker_raw`
- **WHEN** sync runs and `adapter.getProject(externalId)` returns null (item no longer accessible)
- **THEN** the Torii Project row is NOT updated and `tracker_raw` retains its previous value

### Requirement: Monday adapter extracts detail columns
The Monday.com adapter SHALL populate an optional `details` map on the `ExternalProject` it returns by matching a fixed, documented set of Monday board-column titles to `details.*` keys: "Project Manager"→`project_manager`, "Solution Architect"→`solution_architect`, "Senior Consultant"→`solution_consultant`, "Core Solution"→`core_solution`, "Core"→`core_vendor`, "Status Report"→`status_report_url`, "Jira"→`jira_project_url`, "Customer Type"→`customer_type`, "Finance - Use Case"→`finance_use_case`, "Use Case - Group"→`use_case_group`, "Customer Status"→`customer_status`.

Several of these are Monday `mirror` and `board_relation` columns whose value is NOT present in the column's `text`/`value` fields; the adapter MUST request `display_value` (via inline GraphQL fragments on `MirrorValue` and `BoardRelationValue`) and pin a Monday API version that exposes it. For each mapped column the value MUST be taken from `display_value` when present, otherwise from `text`. For the two link fields (`status_report_url`, `jira_project_url`) the value MUST be the first `https?://…` URL token extracted from that resolved text (which renders as `"Label - url"`). Empty values MUST be omitted. Columns whose titles are not in the map MUST be ignored for `details` (they remain captured in `tracker_raw`). There MUST be no mapping for `primary_contact` (it has no Monday source).

#### Scenario: Recognized column maps to a details key
- **GIVEN** a Monday item with a column titled "Project Manager" whose text is "Dana Lee"
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** the result includes `details.project_manager = "Dana Lee"`

#### Scenario: Unrecognized column is ignored for details
- **GIVEN** a Monday item with a column titled "Internal Notes"
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** no `details` key is created for it, though it still appears in `tracker_raw`

#### Scenario: Empty recognized column yields no detail value
- **GIVEN** a Monday item with a "Core Solution" column whose text is empty
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `details.core_solution` is absent (not an empty string)

#### Scenario: Link column yields the extracted URL
- **GIVEN** a Monday item whose "Jira" column text is `"PES-31619 - https://portx.atlassian.net/browse/PES-31619"`
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `details.jira_project_url` equals `https://portx.atlassian.net/browse/PES-31619` (the label prefix is stripped)

#### Scenario: Link column with no URL yields no value
- **GIVEN** a Monday item whose "Status Report" column text contains no `http(s)://` token
- **WHEN** the adapter builds the `ExternalProject`
- **THEN** `details.status_report_url` is absent

### Requirement: Board-listing and per-item queries share one column selection
The Monday adapter's board-listing query (`LIST_BOARDS_QUERY`, used by bulk sync) and per-item query (`GET_ITEM_QUERY`, used by on-demand/force sync and import) MUST request an identical `column_values` field selection, including the `display_value` inline fragments for `MirrorValue` and `BoardRelationValue`. The selection MUST be defined once and reused by both queries so they cannot drift; a field added for a future Monday column MUST therefore appear in both queries automatically. The minimal fallback queries (which intentionally omit `column_values`) are exempt.

#### Scenario: A newly added selection field appears in both queries
- **GIVEN** a developer adds a field or column-type fragment to the shared `column_values` selection
- **WHEN** the adapter issues either the board-listing query or the per-item query
- **THEN** both queries request that field, so bulk sync and per-item sync/import resolve the column identically

#### Scenario: Per-item sync and import return the same columns as bulk sync
- **GIVEN** a Monday item with mirror and board_relation columns
- **WHEN** the item is fetched via the board-listing query AND via the per-item query
- **THEN** both responses include the same `column_values` selection (including `display_value`), and the resolved `details` are identical

### Requirement: Harvest.com adapter
The system SHALL ship a Harvest adapter that implements `TrackerAdapter` using Harvest's REST API v2. It MUST support OAuth 2.0 authorization, read-only access to projects, and store both the access token AND the Harvest Account ID (returned in the OAuth callback) encrypted at rest — every Harvest API call requires the `Harvest-Account-Id` header alongside the bearer token.

The adapter MUST also implement a Harvest-specific method `getProjectSnapshot(externalId)` that returns the rich economic data the Harvest UI surfaces: budget hours (nullable), spent hours split into billable and non-billable, internal costs (cents), invoiced and uninvoiced amounts (cents), total project fees (cents), and a per-(task, person) breakdown.

Harvest is read-only for the purposes of the merge engine: Harvest never sources values for any field on `Project`, `key_dates.*`, or `details.*`. The Harvest adapter's `listProjects()` and `getProject()` MAY be invoked from the bulk-link UI but MUST NOT participate in the merge that updates Monday-owned fields.

#### Scenario: Connect a Harvest workspace
- **GIVEN** an admin starts the Harvest connection flow at `GET /api/tracker/harvest/connect`
- **WHEN** they complete the OAuth consent and the callback returns
- **THEN** the system persists a `TrackerConnection` with `provider="harvest"`, encrypts the access token + refresh token, captures the `harvest_account_id` returned in the callback, and verifies the connection by calling `getMetadata()`

#### Scenario: Adapter requires both bearer token AND account ID on every call
- **GIVEN** a Harvest adapter constructed with `{ accessToken, accountId }`
- **WHEN** the adapter issues any HTTP request to api.harvestapp.com
- **THEN** the request carries BOTH `Authorization: Bearer <token>` AND `Harvest-Account-Id: <accountId>` headers

#### Scenario: Adapter surfaces rate-limit errors distinctly
- **GIVEN** the Harvest API responds 429
- **WHEN** the adapter is mid-call
- **THEN** it throws `HarvestRateLimitError` (distinct from `HarvestAuthError`) so the engine and the API surface can react differently (retry-after vs reconnect)

#### Scenario: Harvest project list pages until exhausted
- **GIVEN** a Harvest workspace with 250 projects (3 pages at 100 per page)
- **WHEN** `listProjects()` is called
- **THEN** the adapter issues paged calls until the API reports no more pages and returns 250 `ExternalProject` entries

#### Scenario: Snapshot aggregates per-(task, person)
- **GIVEN** a Harvest project with tasks "03-Development" and "00-Project Management", each carrying time entries from multiple people
- **WHEN** `getProjectSnapshot()` is called
- **THEN** the returned breakdown has one entry per task; each entry's `people` array carries one row per person who logged time, with summed hours and cost

### Requirement: Harvest OAuth flow
The system SHALL expose `GET /api/tracker/harvest/connect` and `GET /api/tracker/harvest/callback` modeled on the existing Monday OAuth pair. The connect endpoint MUST set a signed state cookie before redirecting to `id.getharvest.com`; the callback MUST verify the state cookie, exchange the authorization code for a token pair, and persist a `TrackerConnection` row with the encrypted access token, refresh token, and Harvest account ID.

The system MUST NEVER log access tokens, refresh tokens, or full callback payloads.

#### Scenario: Connect redirects with a signed state cookie
- **GIVEN** an admin hits `GET /api/tracker/harvest/connect`
- **WHEN** the route handler runs
- **THEN** a signed state cookie is set on the response AND the response is a 302 to `id.getharvest.com/oauth2/authorize?...` with `state` in the query string matching the cookie value

#### Scenario: Callback rejects state mismatch
- **GIVEN** the state cookie is missing or its signed value doesn't match the `state` query parameter
- **WHEN** the callback executes
- **THEN** the response is 400; no connection row is created

#### Scenario: Callback persists encrypted tokens + account ID
- **GIVEN** a valid OAuth callback
- **WHEN** the handler exchanges the code and persists the connection
- **THEN** the access token AND refresh token AND account ID are all stored in their encrypted columns; subsequent calls decrypt them transparently

### Requirement: /trackers Harvest connection section
The `/trackers` page SHALL render a "Harvest" connection card alongside the existing Monday card. The card MUST surface: connection status, "Connect Harvest" (when no connection exists), "Refresh" (force-sync), "Test connection" (run `verifyAccess()`), and "Disconnect" (delete the connection row + cascade-delete linked-project snapshots).

When a connection exists, the card MUST also render a "Link Harvest projects" table: one row per Harvest project from `listProjects()`, with a dropdown per row letting the admin select the matching Torii project (or "Skip"). Submitting calls `POST /api/projects/:id/harvest/link` for each non-skipped selection.

#### Scenario: Admin connects Harvest
- **GIVEN** an admin on `/trackers` with no Harvest connection
- **WHEN** they click "Connect Harvest"
- **THEN** the browser navigates to `GET /api/tracker/harvest/connect` which redirects to id.getharvest.com

#### Scenario: After connect, the link table renders
- **GIVEN** an admin and a healthy Harvest connection
- **WHEN** the /trackers page is rendered
- **THEN** the page shows a "Link Harvest projects" table listing every Harvest project from `listProjects()`, with a Torii-project dropdown per row

#### Scenario: Bulk link submits per-row
- **GIVEN** the admin has selected Torii project A for Harvest project 1 and "Skip" for Harvest project 2
- **WHEN** they click Save
- **THEN** one `POST /api/projects/:id/harvest/link` call is made for Harvest project 1; no call is made for Harvest project 2

### Requirement: Tracker provider enum
The `TrackerProvider` enum SHALL include `'monday'` and `'harvest'`. Adding a new provider requires extending the enum AND registering a concrete adapter factory under the new key.

#### Scenario: Enum values
- **GIVEN** the current `TrackerProvider` enum
- **WHEN** a client inspects the enum
- **THEN** it contains exactly `['monday', 'harvest']`

#### Scenario: Connection rows reference the enum
- **GIVEN** a TrackerConnection row with `provider="harvest"`
- **WHEN** the engine loads the row
- **THEN** the value is accepted; a row with an unknown provider value would fail validation

