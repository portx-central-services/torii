# user-preferences Specification

## Purpose
TBD - created by archiving change add-project-detail-fields. Update Purpose after archive.
## Requirements
### Requirement: Per-user UI preferences storage
The system SHALL persist per-user UI preferences keyed by the authenticated person. Preferences MUST be stored server-side so they apply across devices and sessions. The initial preference set MUST include `hiddenProjectColumns`, an array of project-list column identifiers the user has chosen to hide. A user with no stored preferences MUST be treated as having an empty `hiddenProjectColumns` (all columns visible).

#### Scenario: Default when no preferences stored
- **GIVEN** an authenticated user who has never saved preferences
- **WHEN** the client requests their preferences
- **THEN** the system returns `hiddenProjectColumns` as an empty array

#### Scenario: Preferences are scoped to the user
- **GIVEN** two authenticated users with different stored `hiddenProjectColumns`
- **WHEN** each requests their preferences
- **THEN** each receives only their own values

### Requirement: Preferences API
The system SHALL expose `GET /api/me/preferences` returning the authenticated user's preferences and `PUT /api/me/preferences` that upserts them. Both endpoints MUST require an authenticated session and MUST operate only on the caller's own preferences. `PUT` MUST validate that `hiddenProjectColumns` contains only known project-list column identifiers.

#### Scenario: Read own preferences
- **GIVEN** an authenticated user with stored `hiddenProjectColumns: ["solution_consultant"]`
- **WHEN** they call `GET /api/me/preferences`
- **THEN** the response contains `hiddenProjectColumns: ["solution_consultant"]`

#### Scenario: Upsert preferences
- **GIVEN** an authenticated user
- **WHEN** they call `PUT /api/me/preferences` with `hiddenProjectColumns: ["use_case_group","finance_use_case"]`
- **THEN** the system stores those values and subsequent `GET` returns them

#### Scenario: Reject unknown column identifier
- **WHEN** a `PUT /api/me/preferences` body includes a column id not in the known project-list column set
- **THEN** the system returns `400` and does NOT persist the change

#### Scenario: Unauthenticated request is rejected
- **WHEN** an unauthenticated client calls `GET /api/me/preferences`
- **THEN** the system returns `401`

