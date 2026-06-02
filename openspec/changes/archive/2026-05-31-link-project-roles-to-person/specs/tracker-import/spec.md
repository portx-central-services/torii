## ADDED Requirements

### Requirement: Post-extraction person resolution wires Monday-extracted role strings to Person FKs
After the Monday sync engine applies the merge patch to a project (updating `name`, `phase`, `keyDates`, `details`, etc.), it SHALL run a **person-resolution step** for each of the three role string fields: `details.project_manager`, `details.solution_architect`, `details.solution_consultant`. The resolver MUST:

1. For each non-empty string value, look up `Person` by case-insensitive name match (`LOWER(person.name) = LOWER(monday_string)`).
2. If a Person row is found, set the project's corresponding FK column (`project_manager_id`, `solution_architect_id`, `solution_consultant_id`) to that Person's id.
3. If no Person row matches, create a new Person row with:
   - `name` = the Monday-extracted string verbatim
   - `email` = a synthetic address of the form `<slug>@torii.unresolved`, where `<slug>` is a lowercase, hyphenated form of the name with a numeric suffix if needed to enforce email uniqueness
   - `role` = `Viewer`
   - `defaultCapacityPct` = 100
   - `isAdmin` = false
4. Set the project's FK to the new Person's id.
5. NEVER modify the original `details.*` string — the Monday-extracted string is preserved as immutable history. The FK is the canonical Torii reference; the string is the fallback when the FK is null.

The resolver MUST use case-insensitive **exact** match, not fuzzy or token-based matching. False positives in finance-adjacent data are worse than the operational cost of an admin manually merging two synthetic-email duplicates.

The resolver runs on every sync — bulk, force-refresh-linked, and single-project paths — so a Person row created on one sync can be re-matched on the next without re-creation.

#### Scenario: Resolver matches an existing Person by case-insensitive name
- **GIVEN** a Person row `{ name: "Aaron Levy", email: "aaron@portx.io" }` exists
- **WHEN** a Monday sync brings `details.project_manager = "aaron levy"` on a project
- **THEN** the project's `project_manager_id` is set to that Person's id; no new Person row is created

#### Scenario: Resolver creates a new Person when no match
- **GIVEN** no Person row matches "Sarah Imported"
- **WHEN** a Monday sync brings `details.solution_consultant = "Sarah Imported"` on a project
- **THEN** a new Person row is created with `name = "Sarah Imported"`, `email = "sarah-imported@torii.unresolved"`, `role = Viewer`; the project's `solution_consultant_id` is set to the new row's id

#### Scenario: Synthetic-email collision is resolved with a numeric suffix
- **GIVEN** a Person `{ name: "Aaron Levy", email: "aaron-levy@torii.unresolved" }` already exists from a prior sync
- **WHEN** the resolver creates a new Person for a different "Aaron-Levy" (e.g., punctuation difference yielding the same slug)
- **THEN** the new Person's email is `aaron-levy-2@torii.unresolved` (or `-3`, etc., on further collision)

#### Scenario: Empty string values are skipped
- **GIVEN** a project whose `details.solution_consultant` is empty or absent
- **WHEN** the resolver runs
- **THEN** no Person row is created and `solution_consultant_id` remains null

#### Scenario: Resolver does not mutate `details` strings
- **GIVEN** a project whose `details.project_manager = "Aaron Levy"`
- **WHEN** the resolver runs and sets `project_manager_id` to a matched Person
- **THEN** `details.project_manager` is still exactly `"Aaron Levy"` afterward (preserved as immutable Monday-extracted history)
