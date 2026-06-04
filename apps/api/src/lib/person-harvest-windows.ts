import type { DB } from '../db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PerDayHours {
  /** ISO yyyy-mm-dd in UTC. */
  date: string;
  hours: number;
}

export interface PersonHarvestWindows {
  /** Sum across ALL Harvest projects (pinned + customer-only). */
  totals: {
    last7DaysHours: number;
    last30DaysHours: number;
  };
  /** Exactly 7 entries, oldest first, newest last. Days with no logged hours surface as 0. */
  last7DaysByDay: PerDayHours[];
  /** Per-Torii-project sums (customer-only Harvest projects excluded — they have no projectId). */
  perProject7d: Map<string, number>;
  perProject30d: Map<string, number>;
  perProjectLifetime: Map<string, number>;
}

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Walk every `harvest_projects.raw.timeEntries` once and aggregate this person's
 * hours by (date, project, window). Used by both `/api/people/:id/workload` (for
 * the summary tiles and per-row hour columns) and `/api/people/:id/projects`
 * (to mark which projects had recent activity).
 *
 * When `harvestUserId` is null, returns zeroed structures so callers can render
 * without branching. The 7-day-by-day array is always present (zeros when the
 * person has no link or no activity).
 */
export async function computePersonHarvestWindows(
  db: DB,
  harvestUserId: string | null,
): Promise<PersonHarvestWindows> {
  const todayUtc = utcDateOnly(new Date());

  // Build the 7-day shell (oldest first → newest last).
  const last7DaysByDay: PerDayHours[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayUtc.getTime() - i * DAY_MS);
    last7DaysByDay.push({ date: isoDate(d), hours: 0 });
  }
  const byDayIndex = new Map<string, number>();
  for (const row of last7DaysByDay) byDayIndex.set(row.date, row.hours);

  const perProject7d = new Map<string, number>();
  const perProject30d = new Map<string, number>();
  const perProjectLifetime = new Map<string, number>();
  let totalLast7 = 0;
  let totalLast30 = 0;

  if (!harvestUserId) {
    return {
      totals: { last7DaysHours: 0, last30DaysHours: 0 },
      last7DaysByDay,
      perProject7d,
      perProject30d,
      perProjectLifetime,
    };
  }

  const cutoff7 = todayUtc.getTime() - 6 * DAY_MS; // include today + 6 prior days
  const cutoff30 = todayUtc.getTime() - 29 * DAY_MS;

  const harvestProjects = await db.harvestProject.findMany({
    select: { projectId: true, breakdown: true, raw: true },
  });

  for (const hp of harvestProjects) {
    // Lifetime — read from the cached breakdown (per-(task, person) summary).
    const breakdown = (hp.breakdown ?? []) as Array<{
      people?: Array<{ personId: string; hours: number }>;
    }>;
    let lifetime = 0;
    for (const task of breakdown) {
      for (const row of task.people ?? []) {
        if (row.personId === harvestUserId) lifetime += row.hours;
      }
    }
    if (lifetime > 0 && hp.projectId) {
      perProjectLifetime.set(
        hp.projectId,
        (perProjectLifetime.get(hp.projectId) ?? 0) + lifetime,
      );
    }

    // Windows — walk raw.timeEntries (each is a logged interval with a date).
    const rawObj = hp.raw as {
      timeEntries?: Array<{ spent_date?: string; hours?: number; user?: { id?: number | string } }>;
    } | null;
    const entries = rawObj?.timeEntries ?? [];
    for (const entry of entries) {
      if (String(entry.user?.id ?? '') !== harvestUserId) continue;
      if (!entry.spent_date) continue;
      const spent = new Date(`${entry.spent_date}T00:00:00Z`).getTime();
      if (!Number.isFinite(spent) || spent < cutoff30) continue;
      const hours = entry.hours ?? 0;
      totalLast30 += hours;
      if (hp.projectId) {
        perProject30d.set(hp.projectId, (perProject30d.get(hp.projectId) ?? 0) + hours);
      }
      if (spent >= cutoff7) {
        totalLast7 += hours;
        if (hp.projectId) {
          perProject7d.set(hp.projectId, (perProject7d.get(hp.projectId) ?? 0) + hours);
        }
        const date = entry.spent_date;
        if (byDayIndex.has(date)) byDayIndex.set(date, (byDayIndex.get(date) ?? 0) + hours);
      }
    }
  }

  // Apply byDayIndex back to the shell (preserves day order).
  for (const row of last7DaysByDay) {
    row.hours = Number((byDayIndex.get(row.date) ?? 0).toFixed(2));
  }

  // Round per-project totals.
  for (const [k, v] of perProject7d) perProject7d.set(k, Number(v.toFixed(2)));
  for (const [k, v] of perProject30d) perProject30d.set(k, Number(v.toFixed(2)));
  for (const [k, v] of perProjectLifetime) perProjectLifetime.set(k, Number(v.toFixed(2)));

  return {
    totals: {
      last7DaysHours: Number(totalLast7.toFixed(2)),
      last30DaysHours: Number(totalLast30.toFixed(2)),
    },
    last7DaysByDay,
    perProject7d,
    perProject30d,
    perProjectLifetime,
  };
}
