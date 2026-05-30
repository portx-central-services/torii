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
  /** Case-insensitive allowlist; matching emails are set isAdmin=true on every sign-in. */
  adminEmails?: string[];
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
  // We intentionally do not gate on `email_verified` here. Keycloak is the sole IdP and
  // the access decision; `ALLOWED_EMAIL_DOMAINS` is the access gate. Re-checking the
  // claim second-guesses the IdP and blocks legitimate users whose realm-mapped Google
  // accounts didn't propagate `email_verified=true` (fix that upstream by setting
  // "Trust Email" on the Google identity provider in the realm).

  if (opts.allowedDomains.length > 0) {
    const domain = email.split('@')[1];
    if (!domain || !opts.allowedDomains.includes(domain.toLowerCase())) {
      return { status: 'forbidden', reason: `Domain ${domain ?? '(none)'} not allowed` };
    }
  }

  const name = claims.name ?? email.split('@')[0] ?? email;
  // Reconcile admin status against the allowlist on every sign-in (idempotent).
  const adminAllowlist = (opts.adminEmails ?? []).map((e) => e.toLowerCase());
  const isAdmin = adminAllowlist.includes(email);

  const person = await opts.db.person.upsert({
    where: { email },
    update: { name, isAdmin },
    create: { email, name, role: Role.Viewer, isAdmin },
  });

  const session = await opts.db.session.create({
    data: {
      personId: person.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return { status: 'ok', sessionId: session.id, personId: person.id };
}
