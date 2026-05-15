import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../src/sync/encryption.js';

const KEY = '0'.repeat(64); // 32 bytes of zeros, hex

describe('encryptToken / decryptToken', () => {
  it('round-trips a string', () => {
    const packed = encryptToken('hello-token', KEY);
    expect(packed).not.toBe('hello-token');
    expect(decryptToken(packed, KEY)).toBe('hello-token');
  });

  it('produces different ciphertext for the same input (random IV)', () => {
    const a = encryptToken('same', KEY);
    const b = encryptToken('same', KEY);
    expect(a).not.toBe(b);
    expect(decryptToken(a, KEY)).toBe('same');
    expect(decryptToken(b, KEY)).toBe('same');
  });

  it('rejects keys of the wrong length', () => {
    expect(() => encryptToken('x', 'aa')).toThrow();
  });

  it('rejects when an empty key is provided', () => {
    expect(() => encryptToken('x', '')).toThrow();
  });

  it('rejects a tampered ciphertext (auth tag verification)', () => {
    const packed = encryptToken('secret', KEY);
    const tampered = packed.slice(0, -2) + 'AA';
    expect(() => decryptToken(tampered, KEY)).toThrow();
  });
});
