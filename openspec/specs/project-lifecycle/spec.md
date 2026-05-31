# project-lifecycle Specification

## Purpose
TBD - created by archiving change add-integration-dashboard. Update Purpose after archive.
## Requirements
### Requirement: Project entity
The system SHALL persist a Project entity with the fields: `id`, `name`, `phase`, `state`, `key_dates` (kickoff, target_go_live, actual_go_live, hypercare_end), `details`, `owner_id`, `tracker_ref` (nullable), `created_at`, `updated_at`. Phase MUST be one of `Backlog`, `Initiation`, `Design`, `Development`, `UAT`, `GoLiveReadiness`, `Production`. State MUST be one of `OnTrack`, `AtRisk`, `Blocked`, `Done`. The `details` field MUST be a JSON object of optional string members drawn from the fixed set: `project_manager`, `solution_architect`, `solution_consultant`, `core_solution`, `core_vendor`, `primary_contact`, `status_report_url`, `jira_project_url`, `customer_type`, `finance_use_case`, `use_case_group`, `customer_status`. Unknown `details` keys MUST be rejected. `status_report_url` and `jira_project_url`, when present and non-empty, MUST be syntactically valid URLs.

#### Scenario: Create a Torii-native project
- **GIVEN** an authenticated user with the `PM` role
- **WHEN** they submit `POST /api/projects` with a name, initial phase `Initiation`, and state `OnTrack`
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

#### Scenario: Advance from Development to UAT
- **GIVEN** a project with phase `Development`
- **WHEN** an authenticated PM submits `PATCH /api/projects/{id}` with `phase: "UAT"`
- **THEN** the system updates the project's phase to `UAT` and writes a phase-transition audit entry

#### Scenario: Phase change by viewer is forbidden
- **GIVEN** an authenticated user with the `Viewer` role
- **WHEN** they submit a phase update
- **THEN** the system returns `403` and does NOT modify the project

### Requirement: Project state is orthogonal to phase
The system SHALL allow `state` to be updated independently of `phase`. A project MAY be `Blocked` in any phase. A project MUST automatically transition to state `Done` when phase advances to `Production` with `actual_go_live` set, unless the user has explicitly overridden state.

#### Scenario: Mark a Development-phase project as Blocked
- **GIVEN** a project with phase `Development` and state `OnTrack`
- **WHEN** a PM updates state to `Blocked`
- **THEN** the project's state becomes `Blocked` while phase remains `Development`

#### Scenario: Auto-transition to Done on Production
- **GIVEN** a project in `GoLiveReadiness` phase with `actual_go_live` unset and state `OnTrack`
- **WHEN** the PM sets `actual_go_live` to today and advances phase to `Production`
- **THEN** the system sets state to `Done`

### Requirement: Key dates
The system SHALL allow editing of `kickoff`, `project_start`, `uat_start`, `baseline_go_live`, `target_go_live`, `actual_go_live`, and `hypercare_end`. `target_go_live` MUST be on or after `kickoff` when both are set. `actual_go_live` MUST NOT precede `kickoff`. `project_start` MUST NOT precede `kickoff` when both are set.

The `kickoff` key represents PMO intake / formal kickoff (sourced from the Monday "Project Add Date" column). `project_start` is the start of active delivery work, distinct from `kickoff`. `uat_start` is the start of the UAT phase. `baseline_go_live` is the original committed go-live and is informational only — Gantt bars MUST continue to use `target_go_live` as the canonical target; `actual_go_live` is compared against `baseline_go_live` to measure delivery against the original estimate. All seven keys are optional; absence MUST be tolerated. No new database column is added; `key_dates` remains a single JSON column.

#### Scenario: Reject target_go_live before kickoff
- **GIVEN** a project with `kickoff` set to 2026-06-01
- **WHEN** a PM submits `target_go_live` of 2026-05-15
- **THEN** the system returns `400` with a validation error

#### Scenario: All seven keys accepted on read
- **GIVEN** a project whose JSON `key_dates` includes `kickoff`, `project_start`, `uat_start`, `baseline_go_live`, `target_go_live`, `actual_go_live`, and `hypercare_end`
- **WHEN** a client reads the project
- **THEN** the response's `keyDates` includes every set key with its ISO value

#### Scenario: project_start must not precede kickoff
- **GIVEN** a write to `keyDates` where `kickoff = 2026-02-10` and `project_start = 2026-02-05`
- **WHEN** the schema validates the payload
- **THEN** validation fails with a `project_start must not precede kickoff` error on the `project_start` path

#### Scenario: New keys are optional
- **GIVEN** a project whose `key_dates` JSON has only `target_go_live`
- **WHEN** a client reads the project
- **THEN** the response's `keyDates` carries `target_go_live` and no other date keys (the new keys are absent, not null)

### Requirement: Derived projectType on project read responses
The project read shape returned by `GET /api/projects` and `GET /api/projects/:id` SHALL include a derived field `projectType` whose value is `'fintech'` when `details.fintech_parent` is a non-empty (after trimming) string, and `'direct'` otherwise. The field MUST NOT be persisted as a column — it is computed in `serializeProject` and only present on read responses. The field MUST NOT be accepted as input on `POST` or `PATCH` (any client-supplied `projectType` MUST be ignored or rejected).

#### Scenario: fintech_parent set yields fintech
- **GIVEN** a project with `details.fintech_parent = "Acme Holdings"`
- **WHEN** a client reads the project
- **THEN** the response includes `projectType: "fintech"`

#### Scenario: fintech_parent absent yields direct
- **GIVEN** a project with no `fintech_parent` in its `details` (or an empty string)
- **WHEN** a client reads the project
- **THEN** the response includes `projectType: "direct"`

#### Scenario: Whitespace fintech_parent is treated as absent
- **GIVEN** a project with `details.fintech_parent = "   "`
- **WHEN** a client reads the project
- **THEN** the response includes `projectType: "direct"`

#### Scenario: projectType is read-only on the API
- **WHEN** a client submits `POST /api/projects` or `PATCH /api/projects/:id` with `projectType` in the body
- **THEN** the API ignores the field (returns success with the derived value) or rejects with `400`; the project's `details.fintech_parent` is the only writable source of the derivation

### Requirement: Phase enum reflects the PortX PMO seven-phase set
The `Phase` enum SHALL be the ordered set `Backlog`, `Initiation`, `Design`, `Development`, `UAT`, `GoLiveReadiness`, `Production`. Enum values are TypeScript- and Postgres-safe identifiers. A `phaseLabel(phase)` helper SHALL return the human-readable display string; the only non-identity mapping is `GoLiveReadiness` → "Go-Live Readiness".

- New projects created via `POST /api/projects` without an explicit `phase` MUST default to `Backlog`.
- The auto-Done rule on `PATCH /api/projects/:id` MUST fire when the patch advances `phase` to `Production` and `actual_go_live` is set (replacing the prior trigger on `Hypercare`).
- A migration MUST remap existing rows: `Discovery` → `Initiation`, `Build` → `Development`, `UAT` → `UAT`, `Launch` → `GoLiveReadiness`, `Hypercare` → `Production`. The remap also applies to `phase_audit_log.from_phase` / `to_phase`.

#### Scenario: New project defaults to Backlog
- **GIVEN** a PM submits `POST /api/projects` with `{ name: "Acme" }` and no `phase`
- **WHEN** the API creates the row
- **THEN** the created project's `phase` is `Backlog`

#### Scenario: Auto-Done fires on advance to Production with actual_go_live set
- **GIVEN** a project whose current phase is `GoLiveReadiness` and `actual_go_live` is set
- **WHEN** a PM patches the project with `{ phase: "Production" }` and no explicit `state`
- **THEN** the project's `state` is set to `Done`

#### Scenario: Auto-Done does NOT fire on advance to GoLiveReadiness
- **GIVEN** a project whose current phase is `UAT` and `actual_go_live` is unset
- **WHEN** a PM patches the project with `{ phase: "GoLiveReadiness" }`
- **THEN** the project's `state` is unchanged

#### Scenario: Migration remaps legacy phase values
- **GIVEN** a project whose `phase` was `Launch` before the migration
- **WHEN** the `20260530100000_remap_phase_enum_7_phases` migration runs
- **THEN** the project's `phase` is `GoLiveReadiness`

#### Scenario: phaseLabel maps GoLiveReadiness to "Go-Live Readiness"
- **GIVEN** a phase value `GoLiveReadiness`
- **WHEN** the UI renders a phase dropdown/badge via `phaseLabel`
- **THEN** the displayed text is `Go-Live Readiness`; all other phase enum values display as their identifier verbatim

### Requirement: Derived `overBudget` on the project read API
The project read shape returned by `GET /api/projects` and `GET /api/projects/:id` SHALL include a required boolean field `overBudget` derived from the cached Harvest snapshot. The full derivation is owned by the `harvest-integration` capability; this requirement only pins that the value is exposed on the project read shape and is read-only.

The field MUST NOT be persisted as a column on `projects` and MUST NOT be writable on `POST /api/projects` or `PATCH /api/projects/:id`. Any client-supplied `overBudget` MUST be ignored or rejected.

#### Scenario: Read shape always carries the field
- **GIVEN** any project (linked, unlinked, with snapshot, without)
- **WHEN** a client reads the project
- **THEN** the response object contains an `overBudget` boolean — never undefined, never missing

#### Scenario: Write requests cannot set overBudget
- **WHEN** a client submits `POST /api/projects` or `PATCH /api/projects/:id` with `overBudget: true` in the body
- **THEN** the API ignores the field (returns success with the derived value) or rejects with 400; the Harvest snapshot is the only source of the value

