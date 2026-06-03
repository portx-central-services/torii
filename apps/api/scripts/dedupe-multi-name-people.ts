/**
 * One-shot cleanup: find Person rows whose `name` contains a comma (multi-person
 * Monday role values that got mis-extracted as a single Person), split them into
 * individuals, ensure each individual exists as its own Person row, repoint any
 * Project role FKs (ownerId / projectManagerId / solutionArchitectId /
 * solutionConsultantId) at the FIRST split individual, and delete the bad row.
 *
 * Skips rows that still have references the schema doesn't cascade away (any
 * non-zero Allocation / Session / RiskUpdate / PersonProjectCapacity / UserPreference
 * count, or a non-null harvest_user_id). Those rows are flagged for manual review.
 *
 * Idempotent — running twice is a no-op once all bad rows are resolved.
 *
 * Usage:
 *   pnpm --filter @torii/api exec tsx scripts/dedupe-multi-name-people.ts
 *   pnpm --filter @torii/api exec tsx scripts/dedupe-multi-name-people.ts --dry-run
 */
import { PrismaClient } from '@prisma/client';
import { resolvePersonByName, splitRoleNames } from '../src/sync/resolve-people.js';

interface CleanupReport {
  badName: string;
  splitParts: string[];
  firstReplacementId: string | null;
  projectFksRepointed: number;
  deleted: boolean;
  skipReason?: string;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  try {
    const bad = await prisma.person.findMany({
      where: { name: { contains: ',' } },
      select: {
        id: true,
        name: true,
        harvestUserId: true,
        preference: { select: { id: true } },
        _count: {
          select: {
            ownedProjects: true,
            managedProjects: true,
            architectProjects: true,
            consultantProjects: true,
            allocations: true,
            sessions: true,
            phaseTransitions: true,
            riskUpdatesAuthored: true,
            projectCapacities: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const reports: CleanupReport[] = [];

    for (const row of bad) {
      const parts = splitRoleNames(row.name);
      const report: CleanupReport = {
        badName: row.name,
        splitParts: parts,
        firstReplacementId: null,
        projectFksRepointed: 0,
        deleted: false,
      };

      // Hard skips: anything that would cascade-cascade or lose data.
      if (row.harvestUserId !== null) {
        report.skipReason = 'has harvest_user_id; resolve manually';
        reports.push(report);
        continue;
      }
      if (
        row._count.allocations > 0 ||
        row._count.sessions > 0 ||
        row._count.phaseTransitions > 0 ||
        row._count.riskUpdatesAuthored > 0 ||
        row._count.projectCapacities > 0 ||
        row.preference !== null
      ) {
        report.skipReason = `has non-FK references: ${JSON.stringify(row._count)}${row.preference ? ' + preference' : ''}`;
        reports.push(report);
        continue;
      }

      // Ensure each split individual exists; capture the first id for the FK.
      let firstId: string | null = null;
      if (!dryRun) {
        for (const part of parts) {
          const id = await resolvePersonByName(prisma, part);
          if (firstId === null && id) firstId = id;
        }
      } else {
        // Dry-run: look up each part WITHOUT creating.
        for (const part of parts) {
          const existing = await prisma.person.findFirst({
            where: { name: { equals: part, mode: 'insensitive' } },
            select: { id: true },
          });
          if (firstId === null && existing) firstId = existing.id;
        }
      }
      report.firstReplacementId = firstId;

      // Repoint every Project FK pointing to this bad row.
      const repointAffected = (await prisma.$transaction(async (tx) => {
        let total = 0;
        if (!dryRun) {
          const a = await tx.project.updateMany({
            where: { ownerId: row.id },
            data: { ownerId: firstId },
          });
          const b = await tx.project.updateMany({
            where: { projectManagerId: row.id },
            data: { projectManagerId: firstId },
          });
          const c = await tx.project.updateMany({
            where: { solutionArchitectId: row.id },
            data: { solutionArchitectId: firstId },
          });
          const d = await tx.project.updateMany({
            where: { solutionConsultantId: row.id },
            data: { solutionConsultantId: firstId },
          });
          total = a.count + b.count + c.count + d.count;
        } else {
          // Dry-run: only count, don't write.
          total =
            row._count.ownedProjects +
            row._count.managedProjects +
            row._count.architectProjects +
            row._count.consultantProjects;
        }
        return total;
      })) as number;
      report.projectFksRepointed = repointAffected;

      // Delete the bad row.
      if (!dryRun) {
        await prisma.person.delete({ where: { id: row.id } });
      }
      report.deleted = !dryRun;
      reports.push(report);
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          badRowsFound: bad.length,
          deleted: reports.filter((r) => r.deleted).length,
          skipped: reports.filter((r) => r.skipReason).length,
          reports,
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
