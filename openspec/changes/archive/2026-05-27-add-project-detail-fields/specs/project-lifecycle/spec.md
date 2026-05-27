## MODIFIED Requirements

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
