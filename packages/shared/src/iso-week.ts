/**
 * UTC-normalized start of the ISO week (Monday) for the given date.
 * Returns a fresh Date with time = 00:00:00 UTC.
 */
export function isoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Return ISO week starts (Mondays, UTC) covering every week that intersects
 * the inclusive [from, to] range. The first element is `isoWeekStart(from)`,
 * which may be on or before `from`.
 */
export function isoWeeksBetween(from: Date, to: Date): Date[] {
  if (to < from) return [];
  const start = isoWeekStart(from);
  const out: Date[] = [];
  for (
    let cursor = start.getTime();
    cursor <= to.getTime();
    cursor += WEEK_MS
  ) {
    out.push(new Date(cursor));
  }
  return out;
}

/**
 * Format a Date as ISO yyyy-mm-dd in UTC.
 */
export function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Return true if [aStart, aEnd] overlaps [bStart, bEnd] (all inclusive).
 */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
