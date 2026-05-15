import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSignin } from '../src/routes/auth/handle-signin.js';
import type { DB } from '../src/db.js';

function mkDb() {
  const personUpsert = vi.fn();
  const sessionCreate = vi.fn();
  return {
    fns: { personUpsert, sessionCreate },
    db: {
      person: { upsert: personUpsert },
      session: { create: sessionCreate },
    } as unknown as DB,
  };
}

describe('handleSignin', () => {
  let bag: ReturnType<typeof mkDb>;

  beforeEach(() => {
    bag = mkDb();
  });

  it('upserts a new person as Viewer and creates a session', async () => {
    bag.fns.personUpsert.mockResolvedValue({ id: 'person-1', email: 'a@portx.io' });
    bag.fns.sessionCreate.mockResolvedValue({ id: 'session-1' });

    const result = await handleSignin(
      { email: 'a@portx.io', name: 'A User', email_verified: true },
      { db: bag.db, allowedDomains: [] },
    );

    expect(result).toEqual({ status: 'ok', sessionId: 'session-1', personId: 'person-1' });
    expect(bag.fns.personUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'a@portx.io' },
        create: expect.objectContaining({ email: 'a@portx.io', role: 'Viewer' }),
      }),
    );
  });

  it('updates an existing person on subsequent sign-in', async () => {
    bag.fns.personUpsert.mockResolvedValue({ id: 'person-2', email: 'b@portx.io' });
    bag.fns.sessionCreate.mockResolvedValue({ id: 'session-2' });

    const result = await handleSignin(
      { email: 'b@portx.io', name: 'B Updated' },
      { db: bag.db, allowedDomains: [] },
    );

    expect(result.status).toBe('ok');
    expect(bag.fns.personUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { name: 'B Updated' },
      }),
    );
  });

  it('rejects an email from a non-allowed domain', async () => {
    const result = await handleSignin(
      { email: 'someone@external.example', email_verified: true },
      { db: bag.db, allowedDomains: ['portx.io'] },
    );

    expect(result).toEqual({
      status: 'forbidden',
      reason: 'Domain external.example not allowed',
    });
    expect(bag.fns.personUpsert).not.toHaveBeenCalled();
  });

  it('rejects a sign-in with email_verified=false', async () => {
    const result = await handleSignin(
      { email: 'a@portx.io', email_verified: false },
      { db: bag.db, allowedDomains: [] },
    );

    expect(result.status).toBe('forbidden');
    expect(bag.fns.personUpsert).not.toHaveBeenCalled();
  });

  it('rejects when email is missing', async () => {
    const result = await handleSignin(
      { email: '' as string },
      { db: bag.db, allowedDomains: [] },
    );
    expect(result.status).toBe('forbidden');
  });

  it('lower-cases the email before lookup', async () => {
    bag.fns.personUpsert.mockResolvedValue({ id: 'p', email: 'a@portx.io' });
    bag.fns.sessionCreate.mockResolvedValue({ id: 's' });

    await handleSignin(
      { email: 'A@PortX.IO', email_verified: true },
      { db: bag.db, allowedDomains: ['portx.io'] },
    );
    expect(bag.fns.personUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'a@portx.io' } }),
    );
  });
});
