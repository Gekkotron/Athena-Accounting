import { describe, it, expect } from 'vitest';
import {
  bankSyncKey,
  encryptPrivateKey,
  decryptPrivateKey,
} from '../src/domain/bank-sync/crypto.js';

const SECRET = 'a-session-secret-of-at-least-32-characters';
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n';

describe('bank-sync crypto', () => {
  it('round-trips a PEM for the same user', () => {
    const key = bankSyncKey(SECRET);
    const stored = encryptPrivateKey(key, 7, PEM);
    expect(decryptPrivateKey(key, 7, stored)).toBe(PEM);
  });

  it('never stores the plaintext PEM', () => {
    const stored = encryptPrivateKey(bankSyncKey(SECRET), 7, PEM);
    expect(stored).not.toContain('PRIVATE KEY');
    expect(Buffer.from(stored, 'base64').toString('utf8')).not.toContain('PRIVATE KEY');
  });

  it('binds the ciphertext to the owning user (AAD)', () => {
    const key = bankSyncKey(SECRET);
    const stored = encryptPrivateKey(key, 7, PEM);
    expect(() => decryptPrivateKey(key, 8, stored)).toThrow();
  });

  it('fails to decrypt under a different session secret', () => {
    const stored = encryptPrivateKey(bankSyncKey(SECRET), 7, PEM);
    expect(() =>
      decryptPrivateKey(bankSyncKey('another-session-secret-32-chars-long!!'), 7, stored),
    ).toThrow();
  });
});
