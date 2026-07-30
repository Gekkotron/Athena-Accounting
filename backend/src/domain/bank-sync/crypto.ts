import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Encryption at rest for the user's Enable Banking application private key.
// Same construction as domain/mcp/crypto.ts: AES-256-GCM under a key derived
// from SESSION_SECRET via HKDF-SHA256, with the owning user id bound as AAD
// so a ciphertext copied onto another user's row fails authentication.

const HKDF_SALT = 'athena-bank-sync-v1';
const HKDF_INFO = 'credentials-key';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function bankSyncKey(sessionSecret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(sessionSecret, 'utf8'), Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32),
  );
}

function aad(userId: number): Buffer {
  return Buffer.from(`bank-sync:${userId}`, 'utf8');
}

// Returns base64(nonce || ciphertext || tag).
export function encryptPrivateKey(key: Buffer, userId: number, pem: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(userId));
  const enc = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, enc, cipher.getAuthTag()]).toString('base64');
}

export function decryptPrivateKey(key: Buffer, userId: number, stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const enc = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', key, nonce);
  d.setAAD(aad(userId));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
