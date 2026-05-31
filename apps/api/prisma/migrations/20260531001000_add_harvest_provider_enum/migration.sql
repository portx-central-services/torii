-- Add 'harvest' to the TrackerProvider enum.
-- Must run outside a transaction (Postgres restriction on ALTER TYPE ADD VALUE).
ALTER TYPE "TrackerProvider" ADD VALUE IF NOT EXISTS 'harvest';
