-- Phase enum overhaul: 5-phase placeholder set → 7-phase PMO set that matches the
-- PortX Monday board (Backlog, Initiation, Design, Development, UAT,
-- GoLiveReadiness, Production). Existing rows are remapped deterministically:
--   Discovery → Initiation
--   Build     → Development
--   UAT       → UAT
--   Launch    → GoLiveReadiness
--   Hypercare → Production
-- These will be overwritten by the next Monday sync once `phase` becomes
-- Monday-owned in a follow-up change.

-- 1. Rename the existing enum and drop the column default so we can re-type.
ALTER TYPE "Phase" RENAME TO "Phase_old";
ALTER TABLE "projects" ALTER COLUMN "phase" DROP DEFAULT;

-- 2. Create the new enum.
CREATE TYPE "Phase" AS ENUM (
  'Backlog',
  'Initiation',
  'Design',
  'Development',
  'UAT',
  'GoLiveReadiness',
  'Production'
);

-- 3. Re-type projects.phase with an explicit value mapping.
ALTER TABLE "projects"
  ALTER COLUMN "phase" TYPE "Phase"
  USING (
    CASE "phase"::text
      WHEN 'Discovery' THEN 'Initiation'::"Phase"
      WHEN 'Build'     THEN 'Development'::"Phase"
      WHEN 'UAT'       THEN 'UAT'::"Phase"
      WHEN 'Launch'    THEN 'GoLiveReadiness'::"Phase"
      WHEN 'Hypercare' THEN 'Production'::"Phase"
      ELSE 'Backlog'::"Phase"
    END
  );

-- 4. Re-type both phase_audit_log columns the same way.
ALTER TABLE "phase_audit_log"
  ALTER COLUMN "from_phase" TYPE "Phase"
  USING (
    CASE "from_phase"::text
      WHEN 'Discovery' THEN 'Initiation'::"Phase"
      WHEN 'Build'     THEN 'Development'::"Phase"
      WHEN 'UAT'       THEN 'UAT'::"Phase"
      WHEN 'Launch'    THEN 'GoLiveReadiness'::"Phase"
      WHEN 'Hypercare' THEN 'Production'::"Phase"
      ELSE 'Backlog'::"Phase"
    END
  );
ALTER TABLE "phase_audit_log"
  ALTER COLUMN "to_phase" TYPE "Phase"
  USING (
    CASE "to_phase"::text
      WHEN 'Discovery' THEN 'Initiation'::"Phase"
      WHEN 'Build'     THEN 'Development'::"Phase"
      WHEN 'UAT'       THEN 'UAT'::"Phase"
      WHEN 'Launch'    THEN 'GoLiveReadiness'::"Phase"
      WHEN 'Hypercare' THEN 'Production'::"Phase"
      ELSE 'Backlog'::"Phase"
    END
  );

-- 5. Restore the default (now Backlog — the "committed but not yet started" entry).
ALTER TABLE "projects" ALTER COLUMN "phase" SET DEFAULT 'Backlog'::"Phase";

-- 6. Drop the legacy enum.
DROP TYPE "Phase_old";
