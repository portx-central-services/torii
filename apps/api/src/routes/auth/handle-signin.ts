import { Role } from '@prisma/client';
import { SESSION_TTL_MS } from '../../plugins/session.js';
import type { DB } from '../../db.js';

export interface SigninClaims {
  email: string;
  name?: string;
  email_verified?: boolean;
}

export interface HandleSigninOptions {
  db: DB;
  allowedDomains: string[];
}

export type HandleSigninResult =
  | { status: 'ok'; sessionId: string; personId: string }
  | { status: 'forbidden'; reason: string };

export async function handleSignin(
  claims: SigninClaims,
  opts: HandleSigninOptions,
): Promise<HandleSigninResult> {
  const email = claims.email?.toLowerCase().trim();
  if (!email) {
    return { status: 'forbidden', reason: 'No email in claims' };
  }
  if (claims.email_verified === false) {
    return { status: 'forbidden', reason: 'Email not verified' };
  }

  if (opts.allowedDomains.length > 0) {
    const domain = email.split('@')[1];
    if (!domain || !opts.allowedDomains.includes(domain.toLowerCase())) {
      return { status: 'forbidden', reason: `Domain ${domain ?? '(none)'} not allowed` };
    }
  }

  const name = claims.name ?? email.split('@')[0] ?? email;

  const person = await opts.db.person.upsert({
    where: { email },
    update: { name },
    create: { email, name, role: Role.Viewer },
  });

  const session = await opts.db.session.create({
    data: {
      personId: person.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return { status: 'ok', sessionId: session.id, personId: person.id };
}
