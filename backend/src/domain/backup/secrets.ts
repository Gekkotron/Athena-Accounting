import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Encryption at rest for remote-backup destination secrets: the WebDAV
// password and the enc1 backup passphrase. Same construction as
// domain/bank-sync/crypto.ts: AES-256-GCM under a key derived from
// SESSION_SECRET via HKDF-SHA256, with the owning user id AND the field
// name bound as AAD — a ciphertext copied onto another user's row, or
// swapped between the two secret columns, fails authentication.

const HKDF_SALT = 'athena-backup-destination-v1';
const HKDF_INFO = 'secrets-key';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type SecretField = 'secret' | 'passphrase';

export function backupSecretsKey(sessionSecret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(sessionSecret, 'utf8'), Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32),
  );
}

function aad(userId: number, field: SecretField): Buffer {
  return Buffer.from(`backup-destination:${userId}:${field}`, 'utf8');
}

// Returns base64(nonce || ciphertext || tag).
export function encryptSecret(key: Buffer, userId: number, field: SecretField, plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(userId, field));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, enc, cipher.getAuthTag()]).toString('base64');
}

export function decryptSecret(key: Buffer, userId: number, field: SecretField, stored: string): string {
  const buf = Buffer.from(stored, 'base64');
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const enc = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', key, nonce);
  d.setAAD(aad(userId, field));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
