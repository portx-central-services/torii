/**
 * Capacity math shared by the API and the web. Centralizing the formula here
 * means both sides use the same definition of "planned hours" and the same
 * variance thresholds — and one Vitest covers both.
 */

/** Full-time-equivalent week, used as the baseline for planned-hours math. */
export const FULL_CAPACITY_HOURS_PER_WEEK = 40;

/** Variance threshold below which the reconciliation chip is green. */
export const VARIANCE_GREEN_THRESHOLD = 0.1;
/** Variance threshold below which the reconciliation chip is amber (otherwise red). */
export const VARIANCE_AMBER_THRESHOLD = 0.25;

/**
 * Fractional weeks between two ISO yyyy-mm-dd dates (inclusive of `start`,
 * exclusive of `end`). Negative ranges return 0.
 */
export function weeksBetween(startISO: string, endISO: string): number {
  const start = new Date(`${startISO}T00:00:00Z`).getTime();
  const end = new Date(`${endISO}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / (7 * 24 * 60 * 60 * 1000);
}

export interface PlannedHoursInput {
  /** Allocation percentage, integer 0-100. */
  pct: number;
  /** Person's default capacity percentage, integer 0-100. */
  defaultCapacityPct: number;
  /** Allocation start (yyyy-mm-dd ISO). */
  startISO: string;
  /** Allocation end (yyyy-mm-dd ISO). */
  endISO: string;
}

/**
 * Planned hours for a single allocation:
 *   `(pct / 100) × (defaultCapacityPct / 100) × 40 × weeksBetween(start, end)`
 *
 * Allows fractional weeks; never floors. Returns 0 when the date range is invalid
 * or zero-length.
 */
export function plannedHoursForAllocation(input: PlannedHoursInput): number {
  const { pct, defaultCapacityPct, startISO, endISO } = input;
  const weeks = weeksBetween(startISO, endISO);
  return (pct / 100) * (defaultCapacityPct / 100) * FULL_CAPACITY_HOURS_PER_WEEK * weeks;
}

export type VarianceBucket = 'green' | 'amber' | 'red' | 'neutral';

/**
 * Classify a planned-vs-actual pair into a variance bucket.
 *
 *   - `green`   when planned > 0 and `|delta/planned| ≤ 0.10`
 *   - `amber`   when planned > 0 and `0.10 < |delta/planned| ≤ 0.25`
 *   - `red`     when planned > 0 and `|delta/planned| > 0.25`
 *   - `neutral` when planned is 0/null, or actual is null (no Harvest link)
 */
export function varianceBucket(planned: number, actual: number | null): VarianceBucket {
  if (actual === null || planned <= 0) return 'neutral';
  const ratio = Math.abs(actual - planned) / planned;
  if (ratio <= VARIANCE_GREEN_THRESHOLD) return 'green';
  if (ratio <= VARIANCE_AMBER_THRESHOLD) return 'amber';
  return 'red';
}
