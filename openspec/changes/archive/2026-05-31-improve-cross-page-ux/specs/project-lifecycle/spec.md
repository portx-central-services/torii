## ADDED Requirements

### Requirement: solution_consultant display label is "Senior Consultant"
The `details.solution_consultant` field SHALL display as "Senior Consultant" everywhere it surfaces in the UI — project detail page row labels, the projects-list column header, edit-form field labels, and any other user-visible string referencing this role.

The **storage key remains `solution_consultant`**. The detail JSONB key in `projects.details`, the `PROJECT_DETAIL_KEYS` array in shared, the `field_mapping` per-key entry, and the Monday adapter's title map all keep the existing identifier. Only the display string changes.

This brings Torii's UI in line with Monday's column title (which is already "Senior Consultant") and with the PMO's intended meaning of the role.

#### Scenario: Project detail page shows the new label
- **GIVEN** a project with `details.solution_consultant` set
- **WHEN** a user opens the project detail page
- **THEN** the row label reads "Senior Consultant", not "Solution Consultant"

#### Scenario: Storage key is unchanged
- **GIVEN** the rename is complete
- **WHEN** a client reads a project via the API
- **THEN** the response's `details.solution_consultant` key is unchanged (the JSON key stays `solution_consultant`)

#### Scenario: Monday extraction unchanged
- **GIVEN** the Monday adapter has always mapped the "Senior Consultant" column title to the `solution_consultant` storage key
- **WHEN** a sync runs
- **THEN** the behavior is identical to before this change — no Monday-side update is needed
