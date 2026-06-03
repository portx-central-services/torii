-- Self-reported per-person capacity. Adds a new table for per-(person, project)
-- weekly capacity and a column on people for overall "available for new work" %.
--
-- Purely additive: no backfill, no destructive steps. `availability_pct` defaults
-- to 0, so existing rows pick it up automatically.

-- 1. Per-person availability column.
ALTER TABLE "people" ADD COLUMN "availability_pct" INTEGER NOT NULL DEFAULT 0;

-- 2. Per-(person, project) self-reported weekly capacity.
CREATE TABLE "person_project_capacities" (
  "person_id"  TEXT        NOT NULL,
  "project_id" TEXT        NOT NULL,
  "weekly_pct" INTEGER     NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "person_project_capacities_pkey" PRIMARY KEY ("person_id", "project_id")
);

ALTER TABLE "person_project_capacities"
  ADD CONSTRAINT "person_project_capacities_person_id_fkey"
  FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "person_project_capacities"
  ADD CONSTRAINT "person_project_capacities_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
