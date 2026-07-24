import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Optional at-rest encryption for backup dumps. AES-256-GCM (authenticated,
// so tampering and wrong passphrases both fail loudly) with a scrypt-derived
// key. Node built-ins only — no new dependency.
//
// scrypt parameters: N=2^15, r=8, p=1 (~34 MB, tens of ms on the Geekom).
// Interactive-use strength per the 2017 scrypt paper's recommendations;
// raising N later only requires bumping this constant — the parameters
// travel inside the envelope via `kdf`+version so old files keep opening.
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// 128 * N * r plus headroom — scryptSync throws above its default 32 MB
// maxmem without this.
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedEnvelope {
  v: 'enc1';
  kdf: 'scrypt';
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

// Thrown for both wrong-passphrase and tampered-ciphertext — GCM cannot
// distinguish them, and callers shouldn't either (same 400 to the client).
export class BackupDecryptError extends Error {
  constructor() {
    super('wrong passphrase or corrupted backup file');
    this.name = 'BackupDecryptError';
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function encryptEnvelope(plaintext: string, passphrase: string): EncryptedEnvelope {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 'enc1',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptEnvelope(env: EncryptedEnvelope, passphrase: string): string {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(passphrase, Buffer.from(env.salt, 'base64')),
      Buffer.from(env.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(env.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(env.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new BackupDecryptError();
  }
}

export function isEncryptedEnvelope(x: unknown): x is EncryptedEnvelope {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === 'enc1' &&
    o.kdf === 'scrypt' &&
    typeof o.salt === 'string' &&
    typeof o.iv === 'string' &&
    typeof o.authTag === 'string' &&
    typeof o.ciphertext === 'string'
  );
}
