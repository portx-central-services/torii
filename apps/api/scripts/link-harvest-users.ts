/**
 * Bulk-link Torii Person rows to Harvest users when the match is unambiguous.
 *
 * Modes:
 *
 *   pnpm --filter @torii/api exec tsx scripts/link-harvest-users.ts
 *     Dry-run report. Categorizes every Harvest user as one of:
 *       - email-exact   : Harvest user email matches an unlinked Person.email
 *                         (case-insensitive). High-confidence link.
 *       - name-on-synth : Person.email is `*@torii.unresolved` (created by the
 *                         Monday role-name resolver), AND Person.name matches
 *                         the Harvest user's name (case-insensitive).
 *                         Confident enough to auto-link when --apply is set.
 *       - ambiguous     : Multiple unlinked Persons match this Harvest user.
 *                         Never auto-link; admin must resolve via /trackers.
 *       - already-linked: Person already has harvest_user_id set; skip.
 *       - unmatched     : No candidate Person row found.
 *
 *   pnpm --filter @torii/api exec tsx scripts/link-harvest-users.ts --apply
 *     Apply email-exact and name-on-synth matches.
 */
import { PrismaClient, TrackerProvider } from '@prisma/client';
import { decryptToken } from '../src/sync/encryption.js';
import { HarvestAdapter } from '../src/sync/harvest/HarvestAdapter.js';

interface HarvestUser {
  id: string;
  name: string;
  email: string;
}

interface PersonLite {
  id: string;
  name: string;
  email: string;
  harvestUserId: string | null;
}

type MatchKind =
  | 'email-exact'
  | 'name-on-synth'
  | 'ambiguous'
  | 'already-linked'
  | 'unmatched';

interface Candidate {
  harvestUser: HarvestUser;
  kind: MatchKind;
  match: PersonLite | null;
  rivals?: PersonLite[];
}

const SYNTH_EMAIL_DOMAIN = '@torii.unresolved';

function isSynthetic(email: string): boolean {
  return email.toLowerCase().endsWith(SYNTH_EMAIL_DOMAIN);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const TRACKER_TOKEN_KEY = process.env.TRACKER_TOKEN_KEY;
  if (!TRACKER_TOKEN_KEY) {
    console.error('TRACKER_TOKEN_KEY env var required');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const conn = await prisma.trackerConnection.findFirst({
      where: { provider: TrackerProvider.harvest },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!conn || !conn.harvestAccountId) {
      console.error('No Harvest connection (or missing accountId). Re-authorize first.');
      process.exit(1);
    }
    const accessToken = decryptToken(conn.accessTokenEnc, TRACKER_TOKEN_KEY);
    const adapter = new HarvestAdapter({
      workspace: conn.workspace,
      accessToken,
      accountId: conn.harvestAccountId,
    });

    const [harvestUsers, people] = await Promise.all([
      adapter.listUsers(),
      prisma.person.findMany({
        select: { id: true, name: true, email: true, harvestUserId: true },
      }),
    ]);

    // Indexes for matching. Email index includes ALL people (so an already-linked
    // person can still surface as a conflict to keep the report honest).
    const peopleByEmail = new Map<string, PersonLite[]>();
    const peopleByName = new Map<string, PersonLite[]>();
    for (const p of people) {
      const e = p.email.trim().toLowerCase();
      if (e) {
        const arr = peopleByEmail.get(e) ?? [];
        arr.push(p);
        peopleByEmail.set(e, arr);
      }
      const n = p.name.trim().toLowerCase();
      if (n) {
        const arr = peopleByName.get(n) ?? [];
        arr.push(p);
        peopleByName.set(n, arr);
      }
    }

    // Build a set of Harvest user IDs already attached to a Person — so we can
    // mark the Harvest side as already-linked.
    const linkedHarvestUserIds = new Set(
      people.filter((p) => p.harvestUserId).map((p) => p.harvestUserId!),
    );

    const candidates: Candidate[] = [];

    for (const hu of harvestUsers) {
      const email = hu.email.trim().toLowerCase();
      const name = hu.name.trim().toLowerCase();

      if (linkedHarvestUserIds.has(hu.id)) {
        const owner = people.find((p) => p.harvestUserId === hu.id) ?? null;
        candidates.push({ harvestUser: hu, kind: 'already-linked', match: owner });
        continue;
      }

      // 1) Email-exact among Persons with no harvest_user_id yet.
      const emailMatches = (peopleByEmail.get(email) ?? []).filter(
        (p) => p.harvestUserId === null,
      );
      if (emailMatches.length === 1) {
        candidates.push({ harvestUser: hu, kind: 'email-exact', match: emailMatches[0]! });
        continue;
      }
      if (emailMatches.length > 1) {
        candidates.push({ harvestUser: hu, kind: 'ambiguous', match: null, rivals: emailMatches });
        continue;
      }

      // 2) Name match among synthetic-email Persons with no harvest_user_id.
      const nameMatches = (peopleByName.get(name) ?? []).filter(
        (p) => p.harvestUserId === null && isSynthetic(p.email),
      );
      if (nameMatches.length === 1) {
        candidates.push({ harvestUser: hu, kind: 'name-on-synth', match: nameMatches[0]! });
        continue;
      }
      if (nameMatches.length > 1) {
        candidates.push({ harvestUser: hu, kind: 'ambiguous', match: null, rivals: nameMatches });
        continue;
      }

      candidates.push({ harvestUser: hu, kind: 'unmatched', match: null });
    }

    // Report.
    const counts: Record<MatchKind, number> = {
      'email-exact': 0,
      'name-on-synth': 0,
      ambiguous: 0,
      'already-linked': 0,
      unmatched: 0,
    };
    for (const c of candidates) counts[c.kind]++;

    console.log(
      JSON.stringify(
        {
          apply,
          harvestUsers: harvestUsers.length,
          people: people.length,
          counts,
        },
        null,
        2,
      ),
    );

    const printable = candidates.filter((c) => c.kind !== 'already-linked');
    for (const c of printable) {
      const hu = c.harvestUser;
      const m = c.match;
      console.log(
        `  [${c.kind.padEnd(15)}] hv=${hu.id.padEnd(10)} ${hu.name.padEnd(30)} <${hu.email}> → ${
          m ? `${m.name} <${m.email}>` : c.rivals ? `RIVALS: ${c.rivals.map((r) => r.name).join(', ')}` : '—'
        }`,
      );
    }

    if (!apply) {
      console.log('\n(Dry-run. Re-run with --apply to write email-exact + name-on-synth matches.)');
      return;
    }

    // Apply email-exact and name-on-synth. Skip ambiguous and unmatched.
    let applied = 0;
    let conflicts = 0;
    for (const c of candidates) {
      if (c.kind !== 'email-exact' && c.kind !== 'name-on-synth') continue;
      if (!c.match) continue;
      try {
        await prisma.person.update({
          where: { id: c.match.id },
          data: { harvestUserId: c.harvestUser.id },
        });
        applied += 1;
      } catch (err) {
        // The Person.harvestUserId unique index throws on race conditions.
        conflicts += 1;
        console.error(
          'conflict on',
          c.match.name,
          'harvestUserId=' + c.harvestUser.id,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log(`\nApplied ${applied} link${applied === 1 ? '' : 's'}; ${conflicts} conflict${conflicts === 1 ? '' : 's'}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
