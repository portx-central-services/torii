/**
 * Helpers for ISO-week date math, anchored to Monday 00:00 UTC.
 *
 * The risk-tracking schema uses one snapshot per project per ISO week, identified by the
 * Monday of that week as a `DATE` value. ALL comparisons MUST go through these helpers
 * to avoid locale-specific week-start drift.
 */

/** Monday-00:00-UTC of the ISO week containing `now`. */
export function isoWeekMondayUTC(now: Date = new Date()): Date {
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  // Offset to the preceding Monday. JS Sunday = 0, treat as 7 for ISO semantics.
  const isoDay = day === 0 ? 7 : day;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (isoDay - 1)),
  );
  return monday;
}

/** True if two dates fall in the same ISO week (UTC). */
export function isSameIsoWeek(a: Date, b: Date): boolean {
  return isoWeekMondayUTC(a).getTime() === isoWeekMondayUTC(b).getTime();
}

/** Format a Date as YYYY-MM-DD (UTC). */
export function toIsoDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a UTC `Date` at 00:00. */
export function parseIsoDateUTC(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isNaN(dt.getTime()) ? null : dt;
}
