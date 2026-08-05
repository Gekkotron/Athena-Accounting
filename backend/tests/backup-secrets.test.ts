import { describe, it, expect } from 'vitest';
import { backupSecretsKey, encryptSecret, decryptSecret } from '../src/domain/backup/secrets.js';

const KEY = backupSecretsKey('test-session-secret');

describe('backup destination secrets crypto', () => {
  it('round-trips a secret', () => {
    const stored = encryptSecret(KEY, 7, 'passphrase', 'corr3ct horse');
    expect(stored).not.toContain('horse');
    expect(decryptSecret(KEY, 7, 'passphrase', stored)).toBe('corr3ct horse');
  });
  it('a ciphertext moved to another user fails authentication', () => {
    const stored = encryptSecret(KEY, 7, 'passphrase', 'corr3ct horse');
    expect(() => decryptSecret(KEY, 8, 'passphrase', stored)).toThrow();
  });
  it('a ciphertext moved to the other field fails authentication', () => {
    const stored = encryptSecret(KEY, 7, 'secret', 'webdav-password');
    expect(() => decryptSecret(KEY, 7, 'passphrase', stored)).toThrow();
  });
  it('a different session secret fails', () => {
    const stored = encryptSecret(KEY, 7, 'secret', 'webdav-password');
    expect(() => decryptSecret(backupSecretsKey('other'), 7, 'secret', stored)).toThrow();
  });
});
