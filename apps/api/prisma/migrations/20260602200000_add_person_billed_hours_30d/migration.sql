-- Cached 30-day billed-hours total per person. Computed as a tail-of-sync side
-- effect of the existing Harvest scheduled refresh.
--
-- Both columns nullable; no backfill needed. First sync run will populate them.

ALTER TABLE "people" ADD COLUMN "billed_hours_last_30d" DECIMAL(10,2);
ALTER TABLE "people" ADD COLUMN "billed_hours_as_of" TIMESTAMPTZ;
