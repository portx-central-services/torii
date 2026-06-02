import type { Prisma, PrismaClient } from '@prisma/client';

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
 * Resolve the three role strings on a `details` map to Person ids. May create
 * new Person rows in the People table for unknown names; never touches Project.
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
    projectManagerId: await resolvePersonByName(db, d.project_manager),
    solutionArchitectId: await resolvePersonByName(db, d.solution_architect),
    solutionConsultantId: await resolvePersonByName(db, d.solution_consultant),
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
