import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const HKDF_SALT = 'athena-mcp-v1';
const HKDF_INFO = 'content-key';
const WRAP_SALT = 'athena-mcp-wrap';
const WRAP_INFO = 'key-wrap';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function hkdf32(ikm: Buffer, salt: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.from(salt), Buffer.from(info), 32));
}

export function deriveContentKey(tokenBytes: Buffer): Buffer {
  return hkdf32(tokenBytes, HKDF_SALT, HKDF_INFO);
}

export function masterKey(sessionSecret: string): Buffer {
  return hkdf32(Buffer.from(sessionSecret, 'utf8'), WRAP_SALT, WRAP_INFO);
}

export function wrapKey(mk: Buffer, k: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', mk, nonce);
  const enc = Buffer.concat([cipher.update(k), cipher.final()]);
  return Buffer.concat([nonce, enc, cipher.getAuthTag()]).toString('base64');
}

export function unwrapKey(mk: Buffer, wrapped: string): Buffer {
  const buf = Buffer.from(wrapped, 'base64');
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const enc = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', mk, nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

export function encryptEnvelope(key: Buffer, aad: string, plaintext: string): { nonce: string; ct: string } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    nonce: nonce.toString('base64'),
    ct: Buffer.concat([enc, cipher.getAuthTag()]).toString('base64'),
  };
}

export function decryptEnvelope(key: Buffer, aad: string, nonce: string, ct: string): string {
  const nonceBuf = Buffer.from(nonce, 'base64');
  const buf = Buffer.from(ct, 'base64');
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const enc = buf.subarray(0, buf.length - TAG_BYTES);
  const d = createDecipheriv('aes-256-gcm', key, nonceBuf);
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
