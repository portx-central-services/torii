-- Harvest integration: per-project link, account-ID on the connection, and a cached
-- hours-only snapshot table. Hours-only by design (D9) — no monetary columns.
-- The `TrackerProvider` enum is extended with `harvest` in a follow-up migration
-- (Postgres requires `ALTER TYPE ADD VALUE` to run outside a transaction).

-- 1. Per-project Harvest link. Nullable column on projects with a unique index so
--    two Torii projects can't claim the same Harvest project.
ALTER TABLE "projects" ADD COLUMN "harvest_project_id" TEXT;
CREATE UNIQUE INDEX "projects_harvest_project_id_key" ON "projects"("harvest_project_id");

-- 2. Harvest account ID on the connection. Required on every Harvest API call as the
--    `Harvest-Account-Id` header. Not a secret on its own; stored plaintext. Null for Monday.
ALTER TABLE "tracker_connections" ADD COLUMN "harvest_account_id" TEXT;

-- 3. Cached snapshot table. One row per linked Torii project, keyed on project_id.
CREATE TABLE "project_harvest_snapshots" (
  "project_id"               TEXT          NOT NULL,
  "fetched_at"               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "budget_hours"             DECIMAL(10,2),
  "spent_hours_billable"     DECIMAL(10,2) NOT NULL DEFAULT 0,
  "spent_hours_nonbillable"  DECIMAL(10,2) NOT NULL DEFAULT 0,
  "breakdown"                JSONB         NOT NULL DEFAULT '[]'::jsonb,
  "raw"                      JSONB,
  CONSTRAINT "project_harvest_snapshots_pkey" PRIMARY KEY ("project_id")
);

ALTER TABLE "project_harvest_snapshots"
  ADD CONSTRAINT "project_harvest_snapshots_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
