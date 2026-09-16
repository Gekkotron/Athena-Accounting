import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Encryption at rest for the user's TOTP secret. Same construction as
// domain/bank-sync/crypto.ts and domain/mcp/crypto.ts: AES-256-GCM under
// a key derived from SESSION_SECRET via HKDF-SHA256, with the owning
// user id bound as AAD so a ciphertext copied onto another user's row
// fails authentication.

const HKDF_SALT = 'athena-totp-v1';
const HKDF_INFO = 'totp-secret-key';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function totpKey(sessionSecret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(sessionSecret, 'utf8'), Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32),
  );
}

function aad(userId: number): Buffer {
  return Buffer.from(`totp:${userId}`, 'utf8');
}

// Returns base64(nonce || ciphertext || tag).
export function encryptTotpSecret(key: Buffer, userId: number, base32Secret: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(userId));
  const enc = Buffer.concat([cipher.update(base32Secret, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, enc, cipher.getAuthTag()]).toString('base64');
}

export function decryptTotpSecret(key: Buffer, userId: number, stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  if (buf.length < NONCE_BYTES + TAG_BYTES) throw new Error('totp envelope too short');
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const enc = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', key, nonce);
  d.setAAD(aad(userId));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
