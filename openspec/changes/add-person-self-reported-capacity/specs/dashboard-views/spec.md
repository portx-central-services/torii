## MODIFIED Requirements

### Requirement: Per-person view at `/people/:id`
The system SHALL provide a per-person detail view at `/people/:id` accessible to any authenticated user. The view MUST display:

- A header band with the person's name, email, role badge (`PM` or `Viewer`), and an admin badge when `isAdmin === true`.
- A **Workload** section (described below) showing the person's currently-active projects, their self-reported weekly capacity per project, their availability for new commitments, and the existing per-person reconciliation data joined in.
- Four role sections — **Owner**, **Project Manager**, **Solution Architect**, **Senior Consultant** — each listing every project where this person currently holds that role. The same project MAY appear in multiple sections when the person holds more than one role on it.
- Each role-section project row displays: project name (link to `/projects/:id`), current phase badge, current state badge, and the over-budget chip when `project.overBudget === true`.
- Each role section that has no projects MUST render an empty-state line ("No projects as Project Manager" etc.).

Project membership for the role sections is derived from `Project.ownerId`, `project_manager_id`, `solution_architect_id`, and `solution_consultant_id`. The role sections are read-only.

**Workload section (new):**

The Workload section sits between the header band and the role sections. It reads from `GET /api/people/:id/workload` and renders:

1. **Availability row** — labeled "Availability for more work", showing the person's `availabilityPct`. When the viewer matches the editable condition (see below), the value is an inline numeric input (0–100, step 5); otherwise it's a static `N%` display.
2. **Project workload table** — one row per project in the union of (active allocation) ∪ (non-zero self-reported capacity). Columns:
   - Project name (link to `/projects/:id`) + phase badge.
   - **Current weekly capacity** — the self-reported `weeklyPct`. Inline numeric editor (0–100) when editable; static display otherwise.
   - **Planned: N%** — `allocatedPct` from active allocations, muted gray. Read-only at all times (it's PM-owned).
   - **Lifetime hours** — from the reconciliation join. Displayed as `—` when the person is not Harvest-linked.
   - **Variance chip** — green/amber/red/neutral, computed from planned vs. lifetime hours (reusing the existing `varianceBucket` helper).
   - **Remove** button (editable only) — removes the row by PATCHing `weeklyPct: 0` for that project.
3. **Add project** affordance (editable only) — a dropdown of non-Done projects not already in the table. Selecting one creates a capacity row at `weeklyPct: 5` so the row appears immediately for further editing.
4. **Advisory sum line** (always shown) — `Σ reported: X% · availability: Y% · unaccounted: Z%`, where `Z = max(0, defaultCapacityPct - X - Y)`. When `X + Y > defaultCapacityPct`, the line goes amber and reads `over-committed by N%` instead of `unaccounted`. The advisory is purely visual; no mutation is blocked.

**Editable condition:** the section's inline editors, Remove buttons, and Add-project dropdown render ONLY when `viewer.id === person.id` OR `viewer.isAdmin === true`. Other authenticated viewers see the same data read-only.

#### Scenario: Person holds multiple roles
- **GIVEN** a person who is PM on three projects, SA on two, and owner of one (with overlap)
- **WHEN** they open `/people/:id`
- **THEN** the page shows their projects in the appropriate role sections; a project where they are both PM and Owner appears in both

#### Scenario: Empty role sections
- **GIVEN** a person who is only a PM (no SA or SC roles, no owned projects)
- **WHEN** they open `/people/:id`
- **THEN** the PM section lists their projects; the Owner, SA, and SC sections each show "No projects as <role>."

#### Scenario: Project state surfaces over-budget
- **GIVEN** a person's project list includes a project with `overBudget === true`
- **WHEN** the page renders
- **THEN** that project's row carries the "Over budget" chip

#### Scenario: Self viewing own page sees editable Workload
- **GIVEN** authenticated user Aaron viewing `/people/Aaron`
- **WHEN** the page renders
- **THEN** the Workload section's availability and per-project capacity values are inline editors and an Add-project affordance is visible

#### Scenario: Non-admin viewing another user sees read-only Workload
- **GIVEN** authenticated user Drew (non-admin) viewing `/people/Aaron`
- **WHEN** the page renders
- **THEN** the Workload section shows the same values but with no input controls, no Remove buttons, and no Add-project affordance

#### Scenario: Admin viewing another user sees editable Workload
- **GIVEN** authenticated admin Drew viewing `/people/Aaron`
- **WHEN** the page renders
- **THEN** the Workload section renders with full edit affordances (same as self)

#### Scenario: Advisory line flips to amber on over-commit
- **GIVEN** a person with `defaultCapacityPct = 100`, `availabilityPct = 20`, and capacity rows summing to 90%
- **WHEN** the Workload section renders
- **THEN** the advisory line reads `over-committed by 10%` in amber

#### Scenario: Project in workload by self-report only (no active allocation)
- **GIVEN** a person with a capacity row of `weeklyPct = 30` on project P AND no active allocation on P
- **WHEN** the page renders
- **THEN** the row for P shows `Current: 30%`, `Planned: —`, and the variance chip is `neutral` (no planned baseline to compare against)

#### Scenario: Project in workload by active allocation only (no self-report)
- **GIVEN** a person with an active 50% allocation on project P AND no capacity row on P
- **WHEN** the page renders
- **THEN** the row for P shows `Current: 0%`, `Planned: 50%`, and the variance chip reflects 50% vs. lifetime hours
