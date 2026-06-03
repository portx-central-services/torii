/**
 * Merge two Person rows into one. Built for the common duplicate pattern: the
 * same human gets one synthetic Person row (created by the Monday role-name
 * resolver) AND a separate row from their first Keycloak sign-in, with the same
 * name but different email.
 *
 * Modes:
 *
 *   pnpm --filter @torii/api exec tsx scripts/merge-people.ts --find
 *     List every group of Person rows that share a case-insensitive name. Use
 *     this to spot candidates before merging.
 *
 *   pnpm --filter @torii/api exec tsx scripts/merge-people.ts --into <id> --from <id>
 *     Merge `--from` into `--into`. Repoints every FK (Project roles,
 *     Allocations, Sessions, PhaseAuditLog, ProjectRiskUpdate, PersonProjectCapacity,
 *     UserPreference) to `--into`, transfers `harvest_user_id` if `--into` is null
 *     and `--from` is set, then deletes the `--from` row.
 *
 *     Add `--dry-run` to preview without writing.
 *
 * Safety:
 *   - Refuses if BOTH rows have a non-null `harvest_user_id` (admin must decide).
 *   - Refuses if BOTH rows have a `UserPreference` row (admin must decide).
 *   - For `PersonProjectCapacity` collisions (both rows have a row on the same
 *     project), the `--into` row's value wins; the `--from` row is dropped.
 */
import { PrismaClient, type Prisma } from '@prisma/client';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : '__present__';
}

async function findDuplicates(prisma: PrismaClient): Promise<void> {
  const all = await prisma.person.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      harvestUserId: true,
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
  const byName = new Map<string, typeof all>();
  for (const p of all) {
    const key = p.name.trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(p);
  }
  const groups = [...byName.values()].filter((g) => g.length > 1);
  console.log(JSON.stringify({ duplicateGroups: groups.length, groups }, null, 2));
}

async function mergeOne(
  prisma: PrismaClient,
  fromId: string,
  intoId: string,
  dryRun: boolean,
): Promise<void> {
  if (fromId === intoId) throw new Error('--from and --into must be different');
  const from = await prisma.person.findUnique({
    where: { id: fromId },
    include: { preference: { select: { id: true } } },
  });
  const into = await prisma.person.findUnique({
    where: { id: intoId },
    include: { preference: { select: { id: true } } },
  });
  if (!from) throw new Error(`--from id ${fromId} not found`);
  if (!into) throw new Error(`--into id ${intoId} not found`);

  // Safety bars.
  if (from.harvestUserId !== null && into.harvestUserId !== null) {
    throw new Error(
      `Both rows have a harvest_user_id (from=${from.harvestUserId}, into=${into.harvestUserId}). Resolve manually before merging.`,
    );
  }
  if (from.preference !== null && into.preference !== null) {
    throw new Error('Both rows have a UserPreference. Resolve manually before merging.');
  }

  const summary = {
    dryRun,
    from: { id: from.id, name: from.name, email: from.email },
    into: { id: into.id, name: into.name, email: into.email },
    transfers: {} as Record<string, number>,
  };

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Project role FKs (4 columns).
    const r1 = await (dryRun
      ? tx.project.count({ where: { ownerId: fromId } })
      : tx.project.updateMany({ where: { ownerId: fromId }, data: { ownerId: intoId } }).then((r) => r.count));
    const r2 = await (dryRun
      ? tx.project.count({ where: { projectManagerId: fromId } })
      : tx.project
          .updateMany({ where: { projectManagerId: fromId }, data: { projectManagerId: intoId } })
          .then((r) => r.count));
    const r3 = await (dryRun
      ? tx.project.count({ where: { solutionArchitectId: fromId } })
      : tx.project
          .updateMany({ where: { solutionArchitectId: fromId }, data: { solutionArchitectId: intoId } })
          .then((r) => r.count));
    const r4 = await (dryRun
      ? tx.project.count({ where: { solutionConsultantId: fromId } })
      : tx.project
          .updateMany({ where: { solutionConsultantId: fromId }, data: { solutionConsultantId: intoId } })
          .then((r) => r.count));
    summary.transfers.projectRoles = r1 + r2 + r3 + r4;

    // Allocations.
    summary.transfers.allocations = await (dryRun
      ? tx.allocation.count({ where: { personId: fromId } })
      : tx.allocation
          .updateMany({ where: { personId: fromId }, data: { personId: intoId } })
          .then((r) => r.count));

    // Sessions.
    summary.transfers.sessions = await (dryRun
      ? tx.session.count({ where: { personId: fromId } })
      : tx.session
          .updateMany({ where: { personId: fromId }, data: { personId: intoId } })
          .then((r) => r.count));

    // PhaseAuditLog (actorId).
    summary.transfers.phaseTransitions = await (dryRun
      ? tx.phaseAuditLog.count({ where: { actorId: fromId } })
      : tx.phaseAuditLog
          .updateMany({ where: { actorId: fromId }, data: { actorId: intoId } })
          .then((r) => r.count));

    // ProjectRiskUpdate (authorId).
    summary.transfers.riskUpdatesAuthored = await (dryRun
      ? tx.projectRiskUpdate.count({ where: { authorId: fromId } })
      : tx.projectRiskUpdate
          .updateMany({ where: { authorId: fromId }, data: { authorId: intoId } })
          .then((r) => r.count));

    // PersonProjectCapacity — composite PK (personId, projectId). Collision possible.
    const fromCapacities = await tx.personProjectCapacity.findMany({ where: { personId: fromId } });
    let moved = 0;
    let droppedAsDuplicate = 0;
    for (const cap of fromCapacities) {
      const existing = await tx.personProjectCapacity.findUnique({
        where: { personId_projectId: { personId: intoId, projectId: cap.projectId } },
      });
      if (existing) {
        // Canonical row already has a value for this project — drop the from-side row.
        if (!dryRun) {
          await tx.personProjectCapacity.delete({
            where: { personId_projectId: { personId: fromId, projectId: cap.projectId } },
          });
        }
        droppedAsDuplicate += 1;
      } else {
        if (!dryRun) {
          await tx.personProjectCapacity.update({
            where: { personId_projectId: { personId: fromId, projectId: cap.projectId } },
            data: { personId: intoId },
          });
        }
        moved += 1;
      }
    }
    summary.transfers.projectCapacitiesMoved = moved;
    summary.transfers.projectCapacitiesDroppedAsDuplicate = droppedAsDuplicate;

    // UserPreference (1:1).
    if (from.preference && !into.preference) {
      if (!dryRun) {
        await tx.userPreference.update({
          where: { personId: fromId },
          data: { personId: intoId },
        });
      }
      summary.transfers.userPreferenceMoved = 1;
    } else if (from.preference) {
      // Both had one — earlier guard would have thrown.
      summary.transfers.userPreferenceMoved = 0;
    }

    // Transfer harvest_user_id if into is null and from is set.
    if (into.harvestUserId === null && from.harvestUserId !== null) {
      if (!dryRun) {
        await tx.person.update({
          where: { id: intoId },
          data: { harvestUserId: from.harvestUserId },
        });
        await tx.person.update({
          where: { id: fromId },
          data: { harvestUserId: null },
        });
      }
      (summary.transfers as Record<string, unknown>).harvestUserIdTransferred = from.harvestUserId;
    }

    // Finally, delete the loser.
    if (!dryRun) {
      await tx.person.delete({ where: { id: fromId } });
    }
  });

  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  const prisma = new PrismaClient();
  const dryRun = process.argv.includes('--dry-run');
  try {
    if (process.argv.includes('--find')) {
      await findDuplicates(prisma);
      return;
    }
    const fromId = arg('--from');
    const intoId = arg('--into');
    if (!fromId || !intoId || fromId === '__present__' || intoId === '__present__') {
      console.error(
        'Usage: tsx scripts/merge-people.ts --find\n' +
          '       tsx scripts/merge-people.ts --into <id> --from <id> [--dry-run]',
      );
      process.exit(1);
    }
    await mergeOne(prisma, fromId, intoId, dryRun);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
