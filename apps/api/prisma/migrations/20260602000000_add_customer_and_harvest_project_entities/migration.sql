-- Customer + HarvestProject entities. Reshapes the Torii↔Harvest model from 1:1
-- (one project ↔ one Harvest project) to many-to-one rooted at Customer:
--   Customer 1—* Project   (Monday-sourced)
--   Customer 1—* HarvestProject  (Harvest-sourced, optionally pinned to one Project)
--
-- The previously-existing `projects.harvest_project_id` field is removed; the link
-- moves to `harvest_projects.project_id` (nullable; NULL = customer-only / support).
-- `project_harvest_snapshots` is replaced by `harvest_projects` (one row per Harvest
-- project, not per Torii project).
--
-- This migration is destructive at the schema level but data-preserving via inline
-- backfill that reads `project_harvest_snapshots.raw` (which already contains the
-- Harvest API `client` block) to seed customers and rebuild the linkage. No extra
-- Harvest API roundtrips are needed.

-- 1. New tables --------------------------------------------------------------

CREATE TABLE "customers" (
  "id"                TEXT        NOT NULL,
  "name"              TEXT        NOT NULL,
  "harvest_client_id" TEXT,
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customers_harvest_client_id_key" ON "customers"("harvest_client_id");

CREATE TABLE "harvest_projects" (
  "id"                       TEXT          NOT NULL,
  "name"                     TEXT          NOT NULL,
  "customer_id"              TEXT          NOT NULL,
  "project_id"               TEXT,
  "is_billable"              BOOLEAN       NOT NULL DEFAULT TRUE,
  "harvest_project_url"      TEXT          NOT NULL,
  "budget_hours"             DECIMAL(10,2),
  "spent_hours_billable"     DECIMAL(10,2) NOT NULL DEFAULT 0,
  "spent_hours_nonbillable"  DECIMAL(10,2) NOT NULL DEFAULT 0,
  "breakdown"                JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "raw"                      JSONB,
  "fetched_at"               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "created_at"               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updated_at"               TIMESTAMPTZ   NOT NULL,
  CONSTRAINT "harvest_projects_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "harvest_projects_customer_id_idx" ON "harvest_projects"("customer_id");
CREATE INDEX "harvest_projects_project_id_idx" ON "harvest_projects"("project_id");

-- 2. Project gains customer_id ----------------------------------------------

ALTER TABLE "projects" ADD COLUMN "customer_id" TEXT;
CREATE INDEX "projects_customer_id_idx" ON "projects"("customer_id");

-- 3. FKs --------------------------------------------------------------------

ALTER TABLE "harvest_projects"
  ADD CONSTRAINT "harvest_projects_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "harvest_projects"
  ADD CONSTRAINT "harvest_projects_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Backfill ---------------------------------------------------------------
--
-- The cached `project_harvest_snapshots.raw` JSON column carries the Harvest API
-- project payload, including its `client: { id, name }` block. We:
--   a) extract distinct customers from those payloads, inserting one customers row
--      per Harvest client_id;
--   b) for each existing snapshot row, insert a harvest_projects row keyed by the
--      Harvest project ID (sourced from projects.harvest_project_id), carrying the
--      snapshot fields and pinning project_id back to the originating Torii project;
--   c) set projects.customer_id from the joined Harvest client.
--
-- Projects with NO harvest_project_id are left with customer_id = NULL — admins
-- map them later via /trackers.

-- 4a. Seed customers from cached Harvest client blocks.
WITH client_rows AS (
  SELECT DISTINCT
    (s.raw -> 'project' -> 'client' ->> 'id')   AS harvest_client_id,
    (s.raw -> 'project' -> 'client' ->> 'name') AS client_name
  FROM "project_harvest_snapshots" s
  WHERE (s.raw -> 'project' -> 'client' ->> 'id') IS NOT NULL
)
INSERT INTO "customers" ("id", "name", "harvest_client_id", "updated_at")
SELECT
  -- cuid-ish placeholder for the migration; not crypto-strong but unique per row.
  -- Format mirrors prisma's `cuid()` length expectations (25 chars) without binding
  -- to its algorithm — the column has no constraint requiring a specific shape.
  ('c' || substr(md5(random()::text || harvest_client_id), 1, 24)),
  COALESCE(NULLIF(TRIM(client_name), ''), 'Customer ' || harvest_client_id),
  harvest_client_id,
  NOW()
FROM client_rows;

-- 4b. Seed harvest_projects from snapshots. The Harvest project id comes from
--     projects.harvest_project_id, the project_id pin keeps the existing 1:1 link,
--     and the customer_id is resolved via the just-inserted customers row.
INSERT INTO "harvest_projects" (
  "id",
  "name",
  "customer_id",
  "project_id",
  "is_billable",
  "harvest_project_url",
  "budget_hours",
  "spent_hours_billable",
  "spent_hours_nonbillable",
  "breakdown",
  "raw",
  "fetched_at",
  "updated_at"
)
SELECT
  p.harvest_project_id AS id,
  COALESCE(NULLIF(TRIM(s.raw -> 'project' ->> 'name'), ''), p.name) AS name,
  c.id AS customer_id,
  p.id AS project_id,
  -- Harvest's is_billable defaults true when absent from the payload.
  COALESCE((s.raw -> 'project' ->> 'is_billable')::boolean, TRUE) AS is_billable,
  -- Build the Harvest project URL from the most-recent Harvest connection's workspace
  -- when available; fall back to a workspace-less form (still a valid resolve via redirect).
  CASE
    WHEN (SELECT workspace FROM "tracker_connections" WHERE provider = 'harvest' ORDER BY last_synced_at DESC NULLS LAST LIMIT 1) IS NOT NULL
    THEN 'https://' || (SELECT workspace FROM "tracker_connections" WHERE provider = 'harvest' ORDER BY last_synced_at DESC NULLS LAST LIMIT 1) || '.harvestapp.com/projects/' || p.harvest_project_id
    ELSE 'https://app.harvestapp.com/projects/' || p.harvest_project_id
  END AS harvest_project_url,
  s.budget_hours,
  s.spent_hours_billable,
  s.spent_hours_nonbillable,
  s.breakdown,
  s.raw,
  s.fetched_at,
  NOW() AS updated_at
FROM "projects" p
JOIN "project_harvest_snapshots" s ON s.project_id = p.id
LEFT JOIN "customers" c ON c.harvest_client_id = (s.raw -> 'project' -> 'client' ->> 'id')
WHERE p.harvest_project_id IS NOT NULL
  AND c.id IS NOT NULL;

-- 4c. Set projects.customer_id from the harvest_projects rows we just inserted
--     (one Harvest project per Torii project at this point, so a simple update works).
UPDATE "projects" p
SET "customer_id" = hp.customer_id
FROM "harvest_projects" hp
WHERE hp.project_id = p.id;

-- 4d. Integrity check — fail loudly if rows were lost in translation. Snapshots
--     whose `raw.project.client.id` was missing (shouldn't happen in practice, but
--     guard anyway) are surfaced before we drop the source table.
DO $$
DECLARE
  snap_count INTEGER;
  hp_count   INTEGER;
BEGIN
  SELECT COUNT(*) INTO snap_count FROM "project_harvest_snapshots";
  SELECT COUNT(*) INTO hp_count FROM "harvest_projects";
  IF snap_count <> hp_count THEN
    RAISE EXCEPTION 'Backfill row count mismatch: % snapshots vs. % harvest_projects. Aborting migration to preserve data.', snap_count, hp_count;
  END IF;
END $$;

-- 5. Drop the legacy schema -------------------------------------------------

DROP TABLE "project_harvest_snapshots";
DROP INDEX IF EXISTS "projects_harvest_project_id_key";
ALTER TABLE "projects" DROP COLUMN "harvest_project_id";
