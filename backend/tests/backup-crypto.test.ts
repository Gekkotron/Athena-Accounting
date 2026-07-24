import { describe, it, expect } from 'vitest';
import {
  encryptEnvelope,
  decryptEnvelope,
  isEncryptedEnvelope,
  BackupDecryptError,
} from '../src/http/routes/backup/crypto.js';

const PLAINTEXT = JSON.stringify({ version: 4, accounts: [{ name: 'Compte courant' }] });

describe('backup crypto', () => {
  it('round-trips plaintext through encrypt → decrypt', () => {
    const env = encryptEnvelope(PLAINTEXT, 'correct horse battery');
    expect(env.v).toBe('enc1');
    expect(env.kdf).toBe('scrypt');
    expect(decryptEnvelope(env, 'correct horse battery')).toBe(PLAINTEXT);
  });

  it('never emits the plaintext or reuses salts/ivs across calls', () => {
    const a = encryptEnvelope(PLAINTEXT, 'pass-12345');
    const b = encryptEnvelope(PLAINTEXT, 'pass-12345');
    expect(JSON.stringify(a)).not.toContain('Compte courant');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects a wrong passphrase with BackupDecryptError', () => {
    const env = encryptEnvelope(PLAINTEXT, 'right-passphrase');
    expect(() => decryptEnvelope(env, 'wrong-passphrase')).toThrow(BackupDecryptError);
  });

  it('detects tampering — a flipped ciphertext byte fails GCM auth', () => {
    const env = encryptEnvelope(PLAINTEXT, 'pass-12345');
    const bytes = Buffer.from(env.ciphertext, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    const tampered = { ...env, ciphertext: bytes.toString('base64') };
    expect(() => decryptEnvelope(tampered, 'pass-12345')).toThrow(BackupDecryptError);
  });

  it('isEncryptedEnvelope discriminates encrypted from plain dumps', () => {
    const env = encryptEnvelope(PLAINTEXT, 'pass-12345');
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(isEncryptedEnvelope(JSON.parse(PLAINTEXT))).toBe(false);
    expect(isEncryptedEnvelope(null)).toBe(false);
    expect(isEncryptedEnvelope({ v: 'enc1' })).toBe(false);
  });
});
