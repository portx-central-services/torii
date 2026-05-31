## ADDED Requirements

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

## MODIFIED Requirements

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
