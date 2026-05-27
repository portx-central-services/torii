# project-lifecycle Specification

## Purpose
TBD - created by archiving change add-integration-dashboard. Update Purpose after archive.
## Requirements
### Requirement: Project entity
The system SHALL persist a Project entity with the fields: `id`, `name`, `phase`, `state`, `key_dates` (kickoff, target_go_live, actual_go_live, hypercare_end), `details`, `owner_id`, `tracker_ref` (nullable), `created_at`, `updated_at`. Phase MUST be one of `Discovery`, `Build`, `UAT`, `Launch`, `Hypercare`. State MUST be one of `OnTrack`, `AtRisk`, `Blocked`, `Done`. The `details` field MUST be a JSON object of optional string members drawn from the fixed set: `project_manager`, `solution_architect`, `solution_consultant`, `core_solution`, `core_vendor`, `primary_contact`, `status_report_url`, `jira_project_url`, `customer_type`, `finance_use_case`, `use_case_group`, `customer_status`. Unknown `details` keys MUST be rejected. `status_report_url` and `jira_project_url`, when present and non-empty, MUST be syntactically valid URLs.

#### Scenario: Create a Torii-native project
- **GIVEN** an authenticated user with the `PM` role
- **WHEN** they submit `POST /api/projects` with a name, initial phase `Discovery`, and state `OnTrack`
- **THEN** the system persists the project, assigns an id, sets `owner_id` to the caller, and returns `201` with the new project

#### Scenario: Reject invalid phase
- **WHEN** a request is submitted with `phase` set to a value not in the allowed set
- **THEN** the system returns `400` with a validation error and does NOT persist the project

#### Scenario: Persist and return details fields
- **GIVEN** an authenticated PM
- **WHEN** they submit `PATCH /api/projects/{id}` with `details: { project_manager: "Dana Lee", customer_status: "Active" }`
- **THEN** the system persists those members and subsequent reads of the project return them under `details`

#### Scenario: Reject unknown details key
- **WHEN** a request includes `details` with a key not in the fixed set (e.g., `details.foo`)
- **THEN** the system returns `400` with a validation error and does NOT persist the project

#### Scenario: Reject malformed link field
- **WHEN** a request sets `details.jira_project_url` to a non-URL string
- **THEN** the system returns `400` with a validation error

### Requirement: Phase transitions
The system SHALL allow a project's phase to advance to any other phase value. The system MUST record an audit entry capturing `from_phase`, `to_phase`, `actor_id`, and `at` timestamp for every transition.

#### Scenario: Advance from Build to UAT
- **GIVEN** a project with phase `Build`
- **WHEN** an authenticated PM submits `PATCH /api/projects/{id}` with `phase: "UAT"`
- **THEN** the system updates the project's phase to `UAT` and writes a phase-transition audit entry

#### Scenario: Phase change by viewer is forbidden
- **GIVEN** an authenticated user with the `Viewer` role
- **WHEN** they submit a phase update
- **THEN** the system returns `403` and does NOT modify the project

### Requirement: Project state is orthogonal to phase
The system SHALL allow `state` to be updated independently of `phase`. A project MAY be `Blocked` in any phase. A project MUST automatically transition to state `Done` when phase advances to `Hypercare` with `actual_go_live` set, unless the user has explicitly overridden state.

#### Scenario: Mark a Build-phase project as Blocked
- **GIVEN** a project with phase `Build` and state `OnTrack`
- **WHEN** a PM updates state to `Blocked`
- **THEN** the project's state becomes `Blocked` while phase remains `Build`

#### Scenario: Auto-transition to Done on Launch
- **GIVEN** a project in `Launch` phase with `actual_go_live` unset and state `OnTrack`
- **WHEN** the PM sets `actual_go_live` to today and advances phase to `Hypercare`
- **THEN** the system sets state to `Done`

### Requirement: Key dates
The system SHALL allow editing of `kickoff`, `target_go_live`, `actual_go_live`, and `hypercare_end`. `target_go_live` MUST be on or after `kickoff` when both are set. `actual_go_live` MUST NOT precede `kickoff`.

#### Scenario: Reject target_go_live before kickoff
- **GIVEN** a project with `kickoff` set to 2026-06-01
- **WHEN** a PM submits `target_go_live` of 2026-05-15
- **THEN** the system returns `400` with a validation error

