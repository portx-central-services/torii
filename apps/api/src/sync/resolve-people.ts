import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Placeholder strings that Monday users sometimes put in a role column to mean
 * "nobody yet" rather than naming an individual. We deliberately do NOT create
 * Person rows for these. Compare case-insensitively against trimmed input.
 */
export const PLACEHOLDER_ROLE_NAMES: ReadonlySet<string> = new Set([
  'not staffed',
  'tbd',
  'tba',
  'unassigned',
  'n/a',
  'na',
  'none',
]);

/**
 * Split a Monday role-column value into individual person names. Handles the
 * common multi-person pattern ("Alex Costa, Greg Newton") that previously got
 * mis-extracted as a single Person row. Placeholders like "Not Staffed" are
 * filtered out so they never produce a Person row.
 *
 * Returns the cleaned parts in original order. Empty inputs return `[]`.
 */
export function splitRoleNames(raw: string | undefined | null): string[] {
  const s = raw?.trim();
  if (!s) return [];
  return s
    .split(/,\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !PLACEHOLDER_ROLE_NAMES.has(p.toLowerCase()));
}

/**
 * Slug helper for synthetic emails. Lowercase, alphanumerics + hyphens, no leading
 * or trailing hyphens, no doubled hyphens. Falls back to `"unknown"` if the input
 * cleans down to empty.
 */
export function slugifyForEmail(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'unknown';
}

/**
 * Generate a synthetic email guaranteed to be unique across the People table.
 * Tries `<slug>@torii.unresolved`; on collision appends `-2`, `-3`, etc., until a
 * free slot is found. The `.unresolved` TLD is non-deliverable so synthetic
 * addresses can never collide with real DNS-resolvable email.
 */
async function findFreeSyntheticEmail(
  db: Pick<PrismaClient, 'person'>,
  name: string,
): Promise<string> {
  const baseSlug = slugifyForEmail(name);
  for (let i = 1; i < 1000; i += 1) {
    const slug = i === 1 ? baseSlug : `${baseSlug}-${i}`;
    const candidate = `${slug}@torii.unresolved`;
    const existing = await db.person.findUnique({ where: { email: candidate } });
    if (!existing) return candidate;
  }
  // Pathological collision count — extremely unlikely in practice. Fall back to a
  // random suffix so we never throw and abort a sync over an email collision.
  return `${baseSlug}-${Date.now()}@torii.unresolved`;
}

/**
 * Look up an existing Person by case-insensitive name. Returns the row when one
 * exists, null otherwise. Uses Prisma's `mode: 'insensitive'` for the compare.
 */
async function findPersonByName(
  db: Pick<PrismaClient, 'person'>,
  name: string,
): Promise<{ id: string } | null> {
  return db.person.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
}

/**
 * Resolve a single role-name string to a Person id. Looks up by case-insensitive
 * name; creates a new Person with a synthetic email when no match exists. Empty
 * / whitespace-only inputs return null (skip — leave the FK alone).
 */
export async function resolvePersonByName(
  db: Pick<PrismaClient, 'person'>,
  rawName: string | undefined | null,
): Promise<string | null> {
  const name = rawName?.trim();
  if (!name) return null;

  const existing = await findPersonByName(db, name);
  if (existing) return existing.id;

  const email = await findFreeSyntheticEmail(db, name);
  const created = await db.person.create({
    data: {
      name,
      email,
      role: 'Viewer',
      defaultCapacityPct: 100,
      isAdmin: false,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Resolve a comma-separated role-column value to a single FK target. Each
 * named individual is resolved to a Person id (creating new Person rows for
 * unknown names); the FIRST individual's id is returned for the FK slot.
 *
 * Multi-person assignments survive in the People table as separate rows even
 * though the schema only stores one FK per role slot.
 */
export async function resolveFirstPersonFromMultiName(
  db: Pick<PrismaClient, 'person'>,
  rawName: string | undefined | null,
): Promise<string | null> {
  const parts = splitRoleNames(rawName);
  if (parts.length === 0) return null;
  let firstId: string | null = null;
  for (const part of parts) {
    const id = await resolvePersonByName(db, part);
    if (firstId === null && id) firstId = id;
  }
  return firstId;
}

/**
 * Resolve the three role strings on a `details` map to Person ids. May create
 * new Person rows in the People table for unknown names; never touches Project.
 *
 * Each role string MAY be a comma-separated list ("Alex Costa, Greg Newton"),
 * in which case every individual is ensured to exist as a Person row, but only
 * the FIRST is used for the FK slot (the schema has one FK per role).
 *
 * Used by the Monday sync engine to compute the FKs that get folded into a single
 * `project.update` call alongside the merge patch (one DB write per project per
 * sync, not two).
 */
export async function resolvePeopleIdsFromDetails(
  db: PrismaClient | Prisma.TransactionClient,
  details: Record<string, string | undefined> | null | undefined,
): Promise<{
  projectManagerId: string | null;
  solutionArchitectId: string | null;
  solutionConsultantId: string | null;
}> {
  const d = details ?? {};
  return {
    projectManagerId: await resolveFirstPersonFromMultiName(db, d.project_manager),
    solutionArchitectId: await resolveFirstPersonFromMultiName(db, d.solution_architect),
    solutionConsultantId: await resolveFirstPersonFromMultiName(db, d.solution_consultant),
  };
}

/**
 * Walk a project's `details` strings, resolve each role to a Person id (creating
 * new rows as needed), and write the FKs back to the project. Convenience wrapper
 * for the one-shot backfill script — `resolvePeopleIdsFromDetails` + project
 * update in one call.
 *
 * The sync engine uses `resolvePeopleIdsFromDetails` directly so it can fold the
 * FK writes into its existing project.update call (one write per project, not two).
 */
export async function resolveProjectRolePeople(args: {
  db: PrismaClient | Prisma.TransactionClient;
  projectId: string;
  details: Record<string, string | undefined> | null | undefined;
}): Promise<{
  projectManagerId: string | null;
  solutionArchitectId: string | null;
  solutionConsultantId: string | null;
}> {
  const { db, projectId, details } = args;
  const ids = await resolvePeopleIdsFromDetails(db, details);
  await db.project.update({
    where: { id: projectId },
    data: ids,
  });
  return ids;
}
