import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encryptBuffer, decryptBuffer, isBinaryEnvelope, EnvelopeDecryptError,
} from '../binaryEnvelope.js';

describe('binaryEnvelope', () => {
  const plain = randomBytes(4096);

  it('roundtrips', () => {
    const file = encryptBuffer(plain, 'correct horse battery');
    expect(isBinaryEnvelope(file)).toBe(true);
    expect(decryptBuffer(file, 'correct horse battery').equals(plain)).toBe(true);
  });

  it('rejects a wrong passphrase', () => {
    const file = encryptBuffer(plain, 'right-passphrase');
    expect(() => decryptBuffer(file, 'wrong-passphrase')).toThrow(EnvelopeDecryptError);
  });

  it('rejects tampered ciphertext', () => {
    const file = encryptBuffer(plain, 'right-passphrase');
    const idx = file.length - 10;
    file[idx] = (file[idx] ?? 0) ^ 0xff;
    expect(() => decryptBuffer(file, 'right-passphrase')).toThrow(EnvelopeDecryptError);
  });

  it('rejects garbage input', () => {
    expect(isBinaryEnvelope(Buffer.from('not an envelope'))).toBe(false);
    expect(() => decryptBuffer(Buffer.from('not an envelope'), 'x')).toThrow(EnvelopeDecryptError);
  });

  it('rejects malicious header with huge KDF parameters', () => {
    const file = encryptBuffer(plain, 'right-passphrase');
    // Find the header line (between MAGIC and first newline after MAGIC)
    const magicEnd = 16; // "ATHENA-DB-ENC:1\n".length
    const headerEnd = file.indexOf(0x0a, magicEnd);
    // Replace header with a malicious one (huge N value)
    const maliciousHeader = Buffer.from(
      '{"kdf":"scrypt","N":1073741824,"r":8,"p":1,"salt":"aGVsbG8gd29ybGQ=","iv":"aGVsbG8gd29ybGQ=","tag":"aGVsbG8gd29ybGQ="}\n',
      'utf8',
    );
    const maliciousFile = Buffer.concat([
      file.subarray(0, magicEnd),
      maliciousHeader,
      file.subarray((headerEnd ?? -1) + 1),
    ]);
    expect(() => decryptBuffer(maliciousFile, 'right-passphrase')).toThrow(EnvelopeDecryptError);
  });
});
