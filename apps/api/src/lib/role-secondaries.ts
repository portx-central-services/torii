import { splitRoleNames } from '../sync/resolve-people.js';

export type RoleKey = 'project_manager' | 'solution_architect' | 'solution_consultant';

export interface PersonRef {
  id: string;
  name: string;
}

/** Lightweight index for name → Person lookups (case-insensitive). */
export interface PeopleNameIndex {
  byLowerName: Map<string, PersonRef>;
}

export function buildPeopleNameIndex(
  people: ReadonlyArray<{ id: string; name: string }>,
): PeopleNameIndex {
  const byLowerName = new Map<string, PersonRef>();
  for (const p of people) {
    byLowerName.set(p.name.trim().toLowerCase(), { id: p.id, name: p.name });
  }
  return { byLowerName };
}

/**
 * Resolve every individual named in a comma-separated role string to a Person ref
 * via case-insensitive name match. Placeholders ("Not Staffed", "TBD", etc.) are
 * filtered. Unknown names (no matching Person row) are silently dropped — they're
 * surfaced via `details.*` itself elsewhere.
 */
export function resolveAllFromMultiName(
  raw: string | undefined | null,
  index: PeopleNameIndex,
): PersonRef[] {
  const parts = splitRoleNames(raw);
  const out: PersonRef[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const ref = index.byLowerName.get(part.toLowerCase());
    if (!ref) continue;
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}

/**
 * Given a project's details + the FK primary id for each role, return the
 * secondary Person refs (everyone after the primary in the comma list).
 * Used to expose multi-person role assignments through the read API.
 */
export function secondariesForProject(
  details: { project_manager?: string; solution_architect?: string; solution_consultant?: string } | null | undefined,
  primaryIds: {
    projectManagerId: string | null;
    solutionArchitectId: string | null;
    solutionConsultantId: string | null;
  },
  index: PeopleNameIndex,
): {
  projectManager: PersonRef[];
  solutionArchitect: PersonRef[];
  solutionConsultant: PersonRef[];
} {
  function dropPrimary(refs: PersonRef[], primaryId: string | null): PersonRef[] {
    if (!primaryId) return refs;
    return refs.filter((r) => r.id !== primaryId);
  }
  const d = details ?? {};
  return {
    projectManager: dropPrimary(resolveAllFromMultiName(d.project_manager, index), primaryIds.projectManagerId),
    solutionArchitect: dropPrimary(resolveAllFromMultiName(d.solution_architect, index), primaryIds.solutionArchitectId),
    solutionConsultant: dropPrimary(resolveAllFromMultiName(d.solution_consultant, index), primaryIds.solutionConsultantId),
  };
}
