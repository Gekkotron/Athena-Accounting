import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  BackupDecryptError,
  decryptBytes,
  encryptBytes,
} from '../src/http/routes/backup/crypto.js';

describe('encryptBytes / decryptBytes (binary AES-256-GCM envelope)', () => {
  it('round-trips a small payload with the right passphrase', () => {
    const plaintext = Buffer.from('hello world — 42');
    const env = encryptBytes(plaintext, 'correct-horse-battery-staple');
    expect(decryptBytes(env, 'correct-horse-battery-staple').equals(plaintext)).toBe(true);
  });

  it('round-trips a 1 MB random payload', () => {
    const plaintext = randomBytes(1024 * 1024);
    const env = encryptBytes(plaintext, 'another-strong-passphrase-2026');
    expect(decryptBytes(env, 'another-strong-passphrase-2026').equals(plaintext)).toBe(true);
  });

  it('fails with BackupDecryptError on the wrong passphrase', () => {
    const env = encryptBytes(Buffer.from('secret'), 'correct-horse-battery-staple');
    expect(() => decryptBytes(env, 'wrong-passphrase-guess')).toThrowError(BackupDecryptError);
  });

  it('fails with BackupDecryptError on a truncated envelope', () => {
    const env = encryptBytes(Buffer.from('secret bytes'), 'correct-horse-battery-staple');
    const truncated = env.subarray(0, 20);
    expect(() => decryptBytes(truncated, 'correct-horse-battery-staple')).toThrowError(
      BackupDecryptError,
    );
  });

  it('fails with BackupDecryptError on a tampered ciphertext byte', () => {
    const env = encryptBytes(Buffer.from('secret bytes'), 'correct-horse-battery-staple');
    // Flip the last ciphertext byte (past salt+iv+tag).
    const tampered = Buffer.from(env);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptBytes(tampered, 'correct-horse-battery-staple')).toThrowError(
      BackupDecryptError,
    );
  });

  it('produces different ciphertext for the same plaintext on repeated calls (fresh IV)', () => {
    const plaintext = Buffer.from('idempotency check');
    const a = encryptBytes(plaintext, 'pass');
    const b = encryptBytes(plaintext, 'pass');
    expect(a.equals(b)).toBe(false);
  });
});
