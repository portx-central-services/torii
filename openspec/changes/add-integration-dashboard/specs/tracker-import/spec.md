## ADDED Requirements

### Requirement: Tracker adapter interface
The system SHALL define a `TrackerAdapter` interface in `packages/shared` with the methods: `listProjects()`, `getProject(externalId)`, and `getMetadata()` (returns provider name and capabilities). Every concrete adapter MUST implement this interface. The interface MUST be the only contract between the sync engine and concrete providers.

#### Scenario: Adapter registration
- **GIVEN** a new adapter registered at startup under provider key `"monday"`
- **WHEN** the sync engine is asked to sync a TrackerConnection with `provider="monday"`
- **THEN** the engine resolves the adapter from the registry and invokes `listProjects()` through the interface, never through provider-specific code

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
The system SHALL store a per-Project `field_mapping` declaring, for each tracked field, whether `torii` or `monday` is the owner. During sync, the system MUST update only fields whose owner is `monday`. Fields owned by `torii` MUST be preserved exactly. The default mapping MUST be: `name` and `key_dates.target_go_live` owned by `monday`; `phase`, `state`, and all allocations owned by `torii`.

#### Scenario: Sync preserves Torii-owned phase
- **GIVEN** a linked project whose `field_mapping.phase` is `torii` and current phase is `UAT`
- **WHEN** sync runs and Monday.com reports a status that would have mapped to `Build`
- **THEN** the Torii project's phase remains `UAT`

#### Scenario: Sync updates Monday-owned name
- **GIVEN** a linked project whose `field_mapping.name` is `monday`
- **WHEN** sync runs and the Monday.com item name has changed
- **THEN** the Torii project's name is updated to match

### Requirement: Sync triggers
The system SHALL support two sync triggers: (1) a scheduled background job that runs every 30 minutes per active TrackerConnection, and (2) an on-demand "Refresh" action that an admin or PM MAY invoke from the UI for a single project or for an entire connection.

#### Scenario: Scheduled sync runs
- **GIVEN** a healthy TrackerConnection
- **WHEN** 30 minutes have elapsed since the last sync
- **THEN** the system performs a sync and records `last_synced_at` on the connection

#### Scenario: On-demand refresh of a single project
- **WHEN** a PM clicks "Refresh" on a project detail page
- **THEN** the system performs a sync for only that project's `tracker_ref` and updates its Monday-owned fields
