## Why

The project detail page repeats the same facts in several places and gives every section equal visual weight, so the page is hard to scan. Phase, state, target go-live, and tracker-sync status each appear in two or three spots (hero tiles, the settings editor, the side panel), and the twelve `details` fields render as one flat key/value grid. PMs want the important status to stand out and each fact to have a single home.

## What Changes

- Establish a clear hierarchy: a compact header summarizes the project's identity and current status (phase, state, next milestone, tracker-sync), and everything below is supporting detail.
- Remove duplicated facts so phase, state, target go-live, and tracker-sync status each appear exactly once in their canonical home. The hero stops repeating values that the editor/panels already own.
- Group the twelve `details` fields into labeled subgroups — **Team** (project_manager, solution_architect, solution_consultant), **Customer** (customer_type, customer_status, primary_contact), **Systems** (core_solution, core_vendor), **Use case** (finance_use_case, use_case_group), and **Links** (status_report_url, jira_project_url) — instead of one flat list.
- Keep a single scrolling page (no tabs) and preserve all existing behavior: PM-only editing of phase/state, key dates, and torii-owned detail fields; Refresh-from-tracker; allocations; and the Monday details panel.

This is a presentation-only change to the project detail view. No API, data model, or field-ownership behavior changes.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `dashboard-views`: The "Project detail view" requirement is updated to specify the consolidated hierarchy (no duplicated facts) and the labeled subgroup organization of the `details` fields.

## Impact

- **Affected code**: `apps/web/src/routes/project-detail.tsx` (section reorganization), `apps/web/src/app.css` (layout/hierarchy styles). No backend changes.
- **APIs / data**: none.

## Non-goals

- No tabs or multi-route split of the detail page.
- No changes to which fields exist, how they sync, or field ownership.
- No changes to the projects list page, capacity view, or navigation.
- No new charts or data; this is layout and grouping only.

## Rollback plan

- Revert `project-detail.tsx` and the related `app.css` rules to their previous revision. Because nothing outside the detail view changes and there is no data migration, rollback is a pure front-end revert with no residual state.

## Affected teams

- **PMO** — primary consumers of the detail page; benefit from clearer status and grouped details.
- No backend/platform involvement.
