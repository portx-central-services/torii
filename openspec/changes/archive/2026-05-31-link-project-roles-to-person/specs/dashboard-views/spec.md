## ADDED Requirements

### Requirement: Per-person view at `/people/:id`
The system SHALL provide a per-person detail view at `/people/:id` accessible to any authenticated user. The view MUST display:

- A header band with the person's name, email, role badge (`PM` or `Viewer`), and an admin badge when `isAdmin === true`.
- Four sections, one per role: **Owner**, **Project Manager**, **Solution Architect**, **Senior Consultant**.
- Each section lists every project where this person currently holds that role. The same project MAY appear in multiple sections when the person holds more than one role on it.
- Each project row displays: project name (link to `/projects/:id`), current phase badge, current state badge, and the over-budget chip when `project.overBudget === true`.
- Each section that has no projects MUST render an empty-state line ("No projects as Project Manager" etc.).

Project membership is derived from `Project.ownerId`, `project_manager_id`, `solution_architect_id`, and `solution_consultant_id`. The view is read-only — no edit affordances in this change.

#### Scenario: Person holds multiple roles
- **GIVEN** a person who is PM on three projects, SA on two, and owner of one (with overlap)
- **WHEN** they open `/people/:id`
- **THEN** the page shows their projects in the appropriate sections; a project where they are both PM and Owner appears in both sections

#### Scenario: Empty sections
- **GIVEN** a person who is only a PM (no SA or SC roles, no owned projects)
- **WHEN** they open `/people/:id`
- **THEN** the PM section lists their projects; the Owner, SA, and SC sections each show "No projects as <role>."

#### Scenario: Project state surfaces over-budget
- **GIVEN** a person's project list includes a project with `overBudget === true`
- **WHEN** the page renders
- **THEN** that project's row carries the "Over budget" chip

### Requirement: Timeline person filter is driven by Person FKs, not substring matching
The Timeline view's person filter SHALL be a dropdown of Person rows (populated from `GET /api/people`). When a person is selected, the visibility filter MUST compare Person IDs against each project's `ownerId`, `project_manager_id`, `solution_architect_id`, and `solution_consultant_id` — not against substring matches on the legacy `details.*` strings.

The "any role" / role-specific selector behavior from the prior change is preserved: when both person and role are set, the project must hold that specific FK; with person only, any of the four FKs must match; with role only, any project where that FK is non-null qualifies.

#### Scenario: Person dropdown is populated from /api/people
- **GIVEN** the system has 12 Person rows
- **WHEN** the user opens the Timeline page
- **THEN** the Person filter dropdown lists those 12 Person rows by name (plus "All people")

#### Scenario: Filter matches by ID, not substring
- **GIVEN** two Person rows named "Aaron Levy" and "Aaron Levenson" exist as separate FK targets
- **WHEN** the user selects "Aaron Levy" in the dropdown
- **THEN** only projects where `project_manager_id` (etc.) equals Aaron Levy's id are visible; projects whose FK points at Aaron Levenson do NOT appear

#### Scenario: By-person view groups by Person, falling back to string
- **GIVEN** a project with `project_manager_id` set (Person row) and `solution_consultant_id` null but `details.solution_consultant = "Sarah Unresolved"`
- **WHEN** the user switches to By-person view
- **THEN** the project appears in Aaron Levy's group (PM) and ALSO in a "Sarah Unresolved" string-fallback group (SC); the string-fallback group is visually identical to a Person group but has no link to a `/people/:id` page

### Requirement: Project detail + projects list render Person.name with link when FK is set
The three role rows on the project detail page and the three role columns on the projects list SHALL display the resolved Person's name as a link to `/people/:id` when the FK is set, falling back to the legacy `details.*` string (plain text, no link) when the FK is null.

The Projects-page search input (from the prior change) MUST include the resolved Person names in its search haystack, so typing a person's name surfaces every project they hold any role on — independent of whether the legacy `details.*` string is stale.

#### Scenario: Role row links to /people/:id
- **GIVEN** a project whose `projectManager` Person is "Aaron Levy" with id `aaron-id`
- **WHEN** the project detail page renders
- **THEN** the PM row shows "Aaron Levy" rendered as `<a href="/people/aaron-id">`

#### Scenario: Search finds projects by Person.name even when the legacy string is different
- **GIVEN** a project whose `details.project_manager = "Aaron J. Levy"` but the resolved Person's name is "Aaron Levy"
- **WHEN** the user types "aaron levy" on the Projects page search
- **THEN** that project is included in the results
