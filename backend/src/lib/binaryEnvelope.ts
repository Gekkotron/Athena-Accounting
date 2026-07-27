import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const MAGIC = Buffer.from('ATHENA-DB-ENC:1\n', 'ascii');
const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

export class EnvelopeDecryptError extends Error {
  constructor() {
    super('wrong password or corrupted snapshot');
    this.name = 'EnvelopeDecryptError';
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM,
  });
}

export function encryptBuffer(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const header = JSON.stringify({
    kdf: 'scrypt', N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
    salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  });
  return Buffer.concat([MAGIC, Buffer.from(header + '\n', 'utf8'), ciphertext]);
}

export function isBinaryEnvelope(file: Buffer): boolean {
  return file.length > MAGIC.length && file.subarray(0, MAGIC.length).equals(MAGIC);
}

export function decryptBuffer(file: Buffer, passphrase: string): Buffer {
  try {
    if (!isBinaryEnvelope(file)) throw new Error('bad magic');
    const nl = file.indexOf(0x0a, MAGIC.length);
    const h = JSON.parse(file.subarray(MAGIC.length, nl).toString('utf8')) as {
      N: number; r: number; p: number; salt: string; iv: string; tag: string;
    };
    // Untrusted input: bound the KDF cost so a crafted header can't force a
    // giant scrypt allocation before the auth-tag check.
    if (h.N > 2 ** 16 || h.r > 16 || h.p > 2 || h.N < 2 ** 10 || h.r < 1 || h.p < 1) {
      throw new Error('unreasonable KDF parameters');
    }
    const key = scryptSync(passphrase, Buffer.from(h.salt, 'base64'), 32, {
      N: h.N, r: h.r, p: h.p, maxmem: 128 * h.N * h.r * 2,
    });
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(h.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(h.tag, 'base64'));
    return Buffer.concat([decipher.update(file.subarray(nl + 1)), decipher.final()]);
  } catch {
    throw new EnvelopeDecryptError();
  }
}
