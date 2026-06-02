## ADDED Requirements

### Requirement: Project read shape exposes resolved Person rows for the three role fields
The project read shape returned by `GET /api/projects` and `GET /api/projects/:id` SHALL include three additional fields populated from the project's `project_manager_id`, `solution_architect_id`, and `solution_consultant_id` FKs:

- `projectManager: PersonOut | null`
- `solutionArchitect: PersonOut | null`
- `solutionConsultant: PersonOut | null`

Each field MUST resolve to a Person row joined via the FK, or `null` when the FK is unset. The fields MUST NOT be writable on `POST /api/projects` or `PATCH /api/projects/:id`. Role assignment changes happen via the Monday sync or via the per-person admin UI in a future change; this read shape only exposes the resolved Person.

The legacy `details.project_manager` / `solution_architect` / `solution_consultant` string fields **remain in the read shape unchanged** as the immutable Monday-extracted history.

#### Scenario: Project with all three role FKs set
- **GIVEN** a project whose `project_manager_id`, `solution_architect_id`, `solution_consultant_id` all point to existing Person rows
- **WHEN** a client reads the project
- **THEN** `projectManager`, `solutionArchitect`, `solutionConsultant` each resolve to the corresponding `PersonOut` payload (id, name, email, role)

#### Scenario: Project with no role FKs set
- **GIVEN** a freshly-created project with no Monday-extracted role strings yet
- **WHEN** a client reads the project
- **THEN** the three Person fields are all `null`; the `details.*` strings are absent or empty

#### Scenario: Person fields are read-only on write endpoints
- **WHEN** a client submits `POST /api/projects` or `PATCH /api/projects/:id` with `projectManager`, `solutionArchitect`, or `solutionConsultant` in the body
- **THEN** the API ignores those fields (returns success with the derived values from the current FKs) or rejects with 400; the FKs themselves are only written by the Monday sync or the data migration

### Requirement: Display fallback when a role FK is null
The UI (project detail page, projects list, timeline, risks page, by-person view) SHALL render the resolved `Person.name` for each of the three roles when the FK is set, and fall back to the legacy `details.*` string when the FK is null. When BOTH are absent, render `—` (em dash) or hide the row entirely depending on context.

When the Person is rendered, it MUST link to `/people/:id`. When the fallback string is rendered, it MUST NOT be a link.

#### Scenario: FK present
- **GIVEN** a project whose `projectManager` resolves to a Person named "Aaron Levy"
- **WHEN** the project detail page renders the PM row
- **THEN** the row displays "Aaron Levy" as a link to `/people/<aarons-id>`

#### Scenario: FK null, string present
- **GIVEN** a project whose `projectManager` is null but `details.project_manager = "Sarah Imported"` (e.g., a Person row couldn't be auto-resolved)
- **WHEN** the project detail page renders the PM row
- **THEN** the row displays "Sarah Imported" as plain text (no link)

#### Scenario: Both absent
- **GIVEN** a project with no PM assigned in any form
- **WHEN** the project detail page renders the PM row
- **THEN** the row displays `—`
