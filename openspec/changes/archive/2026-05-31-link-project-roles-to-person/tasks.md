## 1. Schema + migration

- [x] 1.1 Add three nullable FK columns to `projects` in `apps/api/prisma/schema.prisma`: `projectManagerId`, `solutionArchitectId`, `solutionConsultantId` — each mapped to a snake_case `*_id` DB column, FK → `people.id`, `onDelete: SetNull`
- [x] 1.2 Add three relation fields on `Project`: `projectManager Person? @relation("ProjectManager", ...)`, same for the other two. Use named relations so multiple FK fields can coexist
- [x] 1.3 Add three reverse relation fields on `Person`: `managedProjects Project[] @relation("ProjectManager")`, same for SA/SC
- [x] 1.4 Add `harvestUserId String? @unique @map("harvest_user_id")` on `Person`. No FK — Harvest user IDs are external.
- [x] 1.5 Run `prisma generate`
- [x] 1.6 Hand-roll migration `<ts>_add_person_fks_for_project_roles`: 4 ALTER TABLE statements (3 FKs on projects, 1 column on people), 3 FK constraints with `ON DELETE SET NULL`, 1 unique index on `people.harvest_user_id`

## 2. Resolver utility

- [x] 2.1 Add `apps/api/src/sync/resolve-people.ts` with `resolveProjectRolePeople({ db, projectId, details })`: walks `details.project_manager`, `details.solution_architect`, `details.solution_consultant`; for each non-empty string, looks up Person by case-insensitive name (`mode: 'insensitive'`); on miss, creates Person with synthetic email `<slug>@torii.unresolved` and `role=Viewer`, `defaultCapacityPct=100`; writes the resolved id to the project's FK column. Returns `{ projectManagerId, solutionArchitectId, solutionConsultantId }`.
- [x] 2.2 `slugify(name)` helper for synthetic email — lowercase, replace non-alphanumeric with `-`, collapse repeats, trim leading/trailing `-`. Append `@torii.unresolved`.
- [x] 2.3 De-dup the synthetic-email when two cleaned names collide (e.g., "Aaron Levy" and "Aaron-Levy") by checking uniqueness and appending `-2`, `-3`, etc., on conflict — never throw.
- [x] 2.4 Vitest: `resolve-people.test.ts` — match-existing, create-new, case-insensitive, empty-string skip, multi-role on a single project, slug collision

## 3. One-shot data migration

- [x] 3.1 Hand-roll a Prisma migration step (separate timestamped folder OR a `prisma db seed`-style script) that walks every `projects` row, reads `details.project_manager` / `solution_architect` / `solution_consultant`, and calls the resolver. Run it once after the schema migration.
- [x] 3.2 Log a summary: `{ projectsScanned, peopleCreated, peopleMatched, peopleSkipped (empty strings) }`. No throws on a single-row failure — log and continue.
- [x] 3.3 Verify in dev DB: every project's three FK columns are populated where the corresponding `details` string was non-empty; row counts in `people` match the distinct case-insensitive name set across the 3 fields × all projects.

## 4. Monday sync wires in the resolver

- [x] 4.1 In `apps/api/src/sync/engine.ts`, after `mergeExternalIntoTorii` returns the patch and the project row is updated, call `resolveProjectRolePeople({ db, projectId: project.id, details: <merged details> })`. Same call on all three engine paths (bulk, force-refresh-linked, single project).
- [x] 4.2 Track the resolver's writes in the SyncResult counts (extend `projectsPatched` to include resolver-only patches, OR add a `peopleResolved` field — pick one and stay consistent)
- [x] 4.3 Vitest: extend `sync-engine.test.ts` with a fixture where the post-merge details contain a new Person name; assert that a Person row is created AND the project's `projectManagerId` is set.

## 5. API: project read shape

- [x] 5.1 Update `apps/api/src/routes/projects.ts` `serializeProject` to accept the joined Person rows and emit `projectManager`, `solutionArchitect`, `solutionConsultant` as `PersonOut | null`. When the FK is null OR the joined Person is null, emit `null` (the UI falls back to the legacy string).
- [x] 5.2 Update the list + detail Prisma queries to `include: { projectManager: true, solutionArchitect: true, solutionConsultant: true, ... }` alongside the existing `harvestSnapshot` include
- [x] 5.3 Add the three optional Person fields to `ProjectOutSchema` in `packages/shared/src/schemas.ts` (`PersonOutSchema.nullable()`)
- [x] 5.4 Update the web `Project` type in `apps/web/src/api/endpoints.ts` to include the three optional fields

## 6. API: per-person projects endpoint

- [x] 6.1 Add `GET /api/people/:id/projects` (any authenticated user) — returns an array of `{ project: ProjectOut, role: 'owner' | 'pm' | 'sa' | 'sc' }`. The same project appears up to four times if the person holds multiple roles.
- [x] 6.2 The query uses Prisma's `where: { OR: [{ ownerId }, { projectManagerId }, { solutionArchitectId }, { solutionConsultantId }] }` then enumerates the roles per row
- [x] 6.3 Vitest: `people.test.ts` — 404 on missing, owner-only project, all-four-roles same person, no-roles empty list

## 7. Web API client

- [x] 7.1 Add `getPersonProjects(personId)` endpoint helper returning `Array<{ project: Project; role: 'owner' | 'pm' | 'sa' | 'sc' }>`
- [x] 7.2 Add `Person` interface to `apps/web/src/api/endpoints.ts` (mirroring `PersonOut`) if not already exported
- [x] 7.3 Verify `listPeople()` is already an endpoint (used by the Timeline dropdown population in #8.3); add if missing

## 8. UI: read-side switches to Person-when-available

- [x] 8.1 **Project detail page** (`apps/web/src/routes/project-detail.tsx`): the three role rows use `project.projectManager?.name ?? project.details?.project_manager ?? '—'` etc. When the Person is set, wrap in a `<Link to={'/people/' + person.id}>`.
- [x] 8.2 **Projects list** (`projects-list.tsx`): same fallback for the three role columns; wrap in Link when Person is set. Update `searchHaystack` to include `project.projectManager?.name` etc. — searching by Person.name should find them even if the `details` string is older/different.
- [x] 8.3 **Timeline person filter** (`timeline.tsx`): replace the string-based `collectPeople(projects)` with a Person dropdown populated from `endpoints.listPeople()`. The filter compares Person IDs against `project.projectManagerId`, `solutionArchitectId`, `solutionConsultantId`, and `ownerId`. Keep "any role" + role-specific filtering.
- [x] 8.4 **Risks page**: no person filter on Risks today (per existing spec); skip — touched implicitly when the Risks page renders project names.
- [x] 8.5 **By-person view in Timeline**: the existing grouping is by `details.<role>` strings. Change to group by `project.projectManager`, `.solutionArchitect`, `.solutionConsultant` (Person rows), falling back to the string when null.

## 9. UI: new /people/:id route

- [x] 9.1 Add `apps/web/src/routes/person-detail.tsx` with `<PersonDetailPage>`. Header: name + email + role badge + admin badge if applicable.
- [x] 9.2 Body: four sections (Owner / PM / SA / SC), each listing the projects in that role. Empty sections show "No projects as <role>."
- [x] 9.3 Each project row: name (link to `/projects/:id`), phase badge, state badge, over-budget chip when `project.overBudget`.
- [x] 9.4 Wire `/people/:id` into `App.tsx`
- [x] 9.5 Wire `<Link to={`/people/${id}`}>` from project-detail role rows + projects-list role cells

## 10. Spec deltas

- [x] 10.1 `project-lifecycle` — Project read shape gains 3 Person fields; display priority rule (Person first, fall back to string)
- [x] 10.2 `tracker-import` — Monday sync runs post-extraction person resolution; resolver semantics (case-insensitive exact match; synthetic email on create)
- [x] 10.3 `dashboard-views` — Timeline person filter switches to Person FK; project detail + projects list display Person.name with link; new `/people/:id` route requirement

## 11. Verification

- [x] 11.1 `pnpm --filter @torii/api test` green
- [x] 11.2 `pnpm --filter @torii/web exec tsc --noEmit` clean
- [x] 11.3 `pnpm --filter @torii/web build` succeeds
- [x] 11.4 Apply the schema migration in dev; verify the 4 new columns + the unique index
- [x] 11.5 Run the one-shot data migration; verify row count in `people` and that every project with non-empty role strings has its FKs populated
- [x] 11.6 Manually: open a project detail page where the role strings are populated — names render as links to `/people/:id`; the per-person page shows the correct project list grouped by role
- [x] 11.7 Manually: Timeline person filter is now a dropdown of Person rows, not a substring input; selecting a person + role narrows the list correctly
- [x] 11.8 Manually: import a NEW Monday project whose role strings reference a Person we haven't seen before — confirm a Person row is created and the FK is set without manual intervention
