/**
 * Live-probe a single Monday-linked project: hit Monday's API directly and dump
 * the current value of the role columns. Use to diagnose "I changed this on
 * Monday but Torii hasn't picked it up" reports.
 *
 * Usage:
 *   pnpm --filter @torii/api exec tsx scripts/probe-monday-project.ts <projectId>
 */
import { PrismaClient } from '@prisma/client';
import { decryptToken } from '../src/sync/encryption.js';

const TRACKER_TOKEN_KEY = process.env.TRACKER_TOKEN_KEY;

async function main() {
  if (!TRACKER_TOKEN_KEY) {
    console.error('TRACKER_TOKEN_KEY env var required');
    process.exit(1);
  }
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('Usage: tsx scripts/probe-monday-project.ts <projectId>');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      console.error('project not found');
      process.exit(1);
    }
    const ref = project.trackerRef as { provider?: string; externalId?: string } | null;
    if (ref?.provider !== 'monday' || !ref.externalId) {
      console.error('not Monday-linked');
      process.exit(1);
    }
    const conn = await prisma.trackerConnection.findFirst({
      where: { provider: 'monday' },
      orderBy: { lastSyncedAt: 'desc' },
    });
    if (!conn) {
      console.error('no Monday connection');
      process.exit(1);
    }
    const token = decryptToken(conn.accessTokenEnc, TRACKER_TOKEN_KEY);
    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({
        query: `query ($id: [ID!]) {
          items(ids: $id) {
            id
            name
            column_values {
              id
              type
              text
              value
              column { title }
              ... on MirrorValue { display_value }
              ... on BoardRelationValue { display_value }
              ... on DependencyValue { display_value }
            }
          }
        }`,
        variables: { id: [ref.externalId] },
      }),
    });
    const body = (await res.json()) as { data?: { items?: Array<{ name: string; column_values: Array<{ column?: { title?: string }; text?: string | null; display_value?: string | null }> }> }; errors?: unknown };
    const item = body.data?.items?.[0];
    if (!item) {
      console.error('Monday returned no item. Response:', JSON.stringify(body).slice(0, 400));
      process.exit(1);
    }
    console.log('Live Monday name:', item.name);
    const cached = project.trackerRaw as { column_values?: Array<{ column?: { title?: string }; text?: string | null; display_value?: string | null }> } | null;
    const interesting = ['Project Manager', 'Solution Architect', 'Senior Consultant'];
    for (const title of interesting) {
      const liveCol = item.column_values.find((c) => c.column?.title === title);
      const cachedCol = cached?.column_values?.find((c) => c.column?.title === title);
      const live = (liveCol?.display_value || liveCol?.text || '').trim();
      const stored = (cachedCol?.display_value || cachedCol?.text || '').trim();
      const drift = live !== stored ? '  ← DRIFT' : '';
      console.log(`  ${title.padEnd(20)} live=${JSON.stringify(live).padEnd(35)} cached=${JSON.stringify(stored)}${drift}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
