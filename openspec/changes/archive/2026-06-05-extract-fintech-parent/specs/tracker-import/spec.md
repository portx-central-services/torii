## MODIFIED Requirements

### Requirement: Field ownership
The system SHALL store a per-Project `field_mapping` declaring, for each tracked field, whether `torii` or `monday` is the owner. During sync, the system MUST update only fields whose owner is `monday`. Fields owned by `torii` MUST be preserved exactly. The default mapping MUST be: `name`, `phase` (sourced from the Monday "Project Phase" status column), and the Monday-sourced `details.*` fields (`details.project_manager`, `details.solution_architect`, `details.solution_consultant`, `details.core_solution`, `details.core_vendor`, `details.status_report_url`, `details.jira_project_url`, `details.customer_type`, `details.finance_use_case`, `details.use_case_group`, `details.customer_status`, `details.fintech_parent`) owned by `monday`; every Monday-sourced key date (`key_dates.kickoff`, `key_dates.project_start`, `key_dates.uat_start`, `key_dates.baseline_go_live`, `key_dates.target_go_live`, `key_dates.actual_go_live`) owned by `monday`; `state`, `key_dates.hypercare_end` (no Monday source), `details.primary_contact` (no Monday source), and all allocations owned by `torii`. Per-key ownership applies — the merge engine MUST iterate `keyDates` entries and apply each independently.

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

#### Scenario: Sync extracts the Fintech Parent column into details.fintech_parent
- **GIVEN** a linked project with default `field_mapping` whose linked Monday item has a column titled "Fintech Parent" with a non-empty text value (e.g., `"Acme Holdings"`)
- **WHEN** sync runs
- **THEN** the Torii project's `details.fintech_parent` is set to `"Acme Holdings"`
- **AND** `GET /api/projects/:id` returns `projectType: "fintech"` for that project (the derived field follows from `details.fintech_parent` being a non-empty string)

#### Scenario: "Fintech" column populates fintech_parent when "Fintech Parent" is empty
- **GIVEN** a linked Monday item whose `"Fintech Parent"` column is empty AND whose `"Fintech"` column has a non-empty text value (e.g., `"Beta Co"`)
- **WHEN** sync runs
- **THEN** the Torii project's `details.fintech_parent` is set to `"Beta Co"` (the fallback)
- **AND** the project derives as `projectType: "fintech"`

#### Scenario: "Fintech Parent" takes precedence when both columns are set
- **GIVEN** a linked Monday item whose `"Fintech Parent"` column is `"Acme Holdings"` AND whose `"Fintech"` column is `"Acme"`
- **WHEN** sync runs
- **THEN** the Torii project's `details.fintech_parent` is set to `"Acme Holdings"` (the preferred column wins regardless of column iteration order)

#### Scenario: Both fintech columns empty leaves details.fintech_parent absent
- **GIVEN** a linked project whose Monday item has both `"Fintech Parent"` and `"Fintech"` columns empty or whitespace-only
- **WHEN** sync runs
- **THEN** the Torii project's `details.fintech_parent` is NOT set
- **AND** the project derives as `projectType: "direct"`

#### Scenario: Sync applies multiple Monday-owned key dates in one patch
- **GIVEN** a linked project with default `field_mapping` and a Monday item exposing `Project Add Date`, `Project Start Date`, `UAT Start Date`, `Expected Go-Live Date`, and `Actual Go-Live Date`
- **WHEN** sync runs
- **THEN** the Torii project's `key_dates` map is updated with `kickoff` (← Project Add Date), `project_start` (← Project Start Date), `uat_start`, `target_go_live`, and `actual_go_live` set from the Monday values

#### Scenario: Per-key torii override on one key date does not block the others
- **GIVEN** a linked project whose `field_mapping."key_dates.target_go_live"` is `torii` and a PM-set value, with the rest of the keyDates entries defaulted to `monday`
- **WHEN** sync runs and Monday reports new values for `Project Add Date`, `UAT Start Date`, and `Expected Go-Live Date`
- **THEN** the Torii project's `key_dates.kickoff` and `key_dates.uat_start` are updated and `key_dates.target_go_live` is preserved exactly as the PM set it
