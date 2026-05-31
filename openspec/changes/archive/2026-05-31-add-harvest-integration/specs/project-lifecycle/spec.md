## MODIFIED Requirements

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
