-- When projects were originally imported, the entire `DEFAULT_FIELD_MAPPING` was
-- snapshotted into each row's `field_mapping` JSON column. At that time the
-- default for `phase` was `'torii'` (PM-owned in Torii). The current default is
-- `'monday'` (sourced from the "Project Phase" Monday column), but the stored
-- snapshot still pins `phase: 'torii'` per-project, which blocks sync from
-- updating phase. Flip those stored values so the next sync picks up real Monday
-- phase data for existing rows.
--
-- We deliberately scope this to rows whose stored value is exactly `'torii'`
-- (the historical default) so we don't override any deliberate PM pin set via
-- a future UI. As of this migration no such pinning UI exists, so every match
-- is a stale snapshot, not user intent.

UPDATE "projects"
SET "field_mapping" = jsonb_set(
  "field_mapping"::jsonb,
  '{phase}',
  '"monday"'::jsonb
)
WHERE "field_mapping"->>'phase' = 'torii';
