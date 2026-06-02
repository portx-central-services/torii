-- Promote the three project-role assignments from free-form strings (in
-- `projects.details`) to first-class Person FKs. The strings stay as immutable
-- Monday-extracted history; the FKs are the canonical Torii reference.
--
-- Also adds `people.harvest_user_id` — the bridge to Harvest's numeric user IDs,
-- populated by the upcoming Allocations ↔ Actuals reconciliation work.

-- 1. Add the three nullable FK columns on projects.
ALTER TABLE "projects" ADD COLUMN "project_manager_id" TEXT;
ALTER TABLE "projects" ADD COLUMN "solution_architect_id" TEXT;
ALTER TABLE "projects" ADD COLUMN "solution_consultant_id" TEXT;

-- 2. FK constraints with ON DELETE SET NULL — deleting a Person doesn't cascade-delete projects.
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_project_manager_id_fkey"
  FOREIGN KEY ("project_manager_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_solution_architect_id_fkey"
  FOREIGN KEY ("solution_architect_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_solution_consultant_id_fkey"
  FOREIGN KEY ("solution_consultant_id") REFERENCES "people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Add the harvest_user_id column on people, unique to enforce one-to-one bridge.
ALTER TABLE "people" ADD COLUMN "harvest_user_id" TEXT;
CREATE UNIQUE INDEX "people_harvest_user_id_key" ON "people"("harvest_user_id");
