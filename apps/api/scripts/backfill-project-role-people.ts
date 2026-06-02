/**
 * One-shot data migration: backfill Person FK columns on `projects` from the
 * legacy `details.project_manager` / `solution_architect` / `solution_consultant`
 * strings. Idempotent — re-running re-resolves and re-writes the FKs without
 * creating duplicate Person rows (case-insensitive name match catches existing).
 *
 * Usage:
 *   pnpm --filter @torii/api exec tsx scripts/backfill-project-role-people.ts
 */
import { PrismaClient } from '@prisma/client';
import { resolveProjectRolePeople } from '../src/sync/resolve-people.js';

interface ProjectRow {
  id: string;
  details: unknown;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const projects: ProjectRow[] = await prisma.project.findMany({
      select: { id: true, details: true },
    });

    let scanned = 0;
    let peopleBefore = await prisma.person.count();
    let projectsWithAnyFkSet = 0;

    for (const project of projects) {
      scanned += 1;
      const details = (project.details ?? {}) as Record<string, string | undefined>;
      const result = await resolveProjectRolePeople({
        db: prisma,
        projectId: project.id,
        details,
      });
      const setCount =
        (result.projectManagerId ? 1 : 0) +
        (result.solutionArchitectId ? 1 : 0) +
        (result.solutionConsultantId ? 1 : 0);
      if (setCount > 0) projectsWithAnyFkSet += 1;
    }

    const peopleAfter = await prisma.person.count();
    console.log(
      JSON.stringify(
        {
          projectsScanned: scanned,
          projectsWithAnyFkSet,
          peopleCreated: peopleAfter - peopleBefore,
          peopleTotalAfter: peopleAfter,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
