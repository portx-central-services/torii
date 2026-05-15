import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(keyHex: string): Buffer {
  if (!keyHex) {
    throw new Error('TRACKER_TOKEN_KEY env var is required for token encryption');
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('TRACKER_TOKEN_KEY must be 32 bytes (64 hex characters)');
  }
  return key;
}

/** Encrypt a string using AES-256-GCM. Returns base64(iv || authTag || ciphertext). */
export function encryptToken(plaintext: string, keyHex: string): string {
  const key = loadKey(keyHex);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptToken(packed: string, keyHex: string): string {
  const key = loadKey(keyHex);
  const buf = Buffer.from(packed, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Encrypted blob is too short');
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
