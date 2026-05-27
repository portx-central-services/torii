## MODIFIED Requirements

### Requirement: Field ownership
The system SHALL store a per-Project `field_mapping` declaring, for each tracked field, whether `torii` or `monday` is the owner. During sync, the system MUST update only fields whose owner is `monday`. Fields owned by `torii` MUST be preserved exactly. The default mapping MUST be: `name`, `key_dates.target_go_live`, and the Monday-sourced `details.*` fields (`details.project_manager`, `details.solution_architect`, `details.solution_consultant`, `details.core_solution`, `details.core_vendor`, `details.status_report_url`, `details.jira_project_url`, `details.customer_type`, `details.finance_use_case`, `details.use_case_group`, `details.customer_status`) owned by `monday`; `phase`, `state`, `details.primary_contact` (no Monday source), and all allocations owned by `torii`.

#### Scenario: Sync preserves Torii-owned phase
- **GIVEN** a linked project whose `field_mapping.phase` is `torii` and current phase is `UAT`
- **WHEN** sync runs and Monday.com reports a status that would have mapped to `Build`
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

## ADDED Requirements

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
