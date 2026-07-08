import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const HKDF_SALT = 'athena-mcp-v1';
const HKDF_INFO = 'content-key';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function deriveContentKey(tokenBytes: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', tokenBytes, Buffer.from(HKDF_SALT), Buffer.from(HKDF_INFO), 32));
}

export function encryptEnvelope(key: Buffer, aad: string, plaintext: string): { nonce: string; ct: string } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { nonce: nonce.toString('base64'), ct: Buffer.concat([enc, cipher.getAuthTag()]).toString('base64') };
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
