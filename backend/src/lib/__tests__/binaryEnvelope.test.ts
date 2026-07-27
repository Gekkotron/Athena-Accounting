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
});
