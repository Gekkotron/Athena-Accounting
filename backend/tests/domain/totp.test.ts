import { describe, it, expect } from 'vitest';
import {
  base32Encode,
  base32Decode,
  generateCode,
  verifyCode,
  otpauthUrl,
  generateSecretBase32,
  generateRecoveryCode,
  normalizeRecoveryCode,
} from '../../src/domain/auth/totp.js';
import {
  totpKey,
  encryptTotpSecret,
  decryptTotpSecret,
} from '../../src/domain/auth/totp-crypto.js';

// RFC 6238 Appendix B test vectors. The reference secret in the RFC is
// the ASCII string "12345678901234567890" (20 bytes, 160 bits) — for
// SHA-1 the shared secret is repeated once. Base32-encoded that's
// "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET_B32 = base32Encode(RFC_SECRET);

// From RFC 6238 Appendix B, "T (seconds)" column — the 6-digit truncation
// of "TOTP" is what the appendix table's last column shows in parens.
// (The 8-digit values are for the SHA-1 example; we always truncate to
// 6 digits so we take the last 6 of each.)
//
//    Time (sec)  | TOTP (T=30, SHA1, 8 digits) | Truncated to 6
//    -----------+-----------------------------+---------------
//    59         | 94287082                    | 287082
//    1111111109 | 07081804                    | 081804
//    1111111111 | 14050471                    | 050471
//    1234567890 | 89005924                    | 005924
//    2000000000 | 69279037                    | 279037
//    20000000000| 65353130                    | 353130
const RFC_VECTORS: Array<[number, string]> = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];

describe('base32 encode/decode', () => {
  it('round-trips arbitrary buffers', () => {
    const inputs = [
      Buffer.from(''),
      Buffer.from([0x00]),
      Buffer.from([0xff, 0xff, 0xff]),
      Buffer.from('12345678901234567890', 'ascii'),
      Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55]),
    ];
    for (const b of inputs) {
      const encoded = base32Encode(b);
      expect(base32Decode(encoded)).toEqual(b);
      // encoded uses only the RFC 4648 alphabet
      expect(encoded).toMatch(/^[A-Z2-7]*$/);
    }
  });

  it('rejects a character outside the alphabet', () => {
    expect(() => base32Decode('ABC!DEF')).toThrow(/invalid base32/);
  });
});

describe('generateCode — RFC 6238 test vectors', () => {
  it.each(RFC_VECTORS)('t=%i → %s', (t, expected) => {
    expect(generateCode(RFC_SECRET_B32, t)).toBe(expected);
  });
});

describe('verifyCode', () => {
  it('accepts the current window and returns its counter', () => {
    const now = 1234567890;
    const code = generateCode(RFC_SECRET_B32, now);
    expect(verifyCode(RFC_SECRET_B32, code, 1, now)).toEqual({
      ok: true,
      counter: Math.floor(now / 30),
    });
  });

  it('accepts the previous window (t-30) and returns its counter', () => {
    const now = 1234567890;
    const code = generateCode(RFC_SECRET_B32, now - 30);
    expect(verifyCode(RFC_SECRET_B32, code, 1, now)).toEqual({
      ok: true,
      counter: Math.floor((now - 30) / 30),
    });
  });

  it('accepts the next window (t+30) and returns its counter', () => {
    const now = 1234567890;
    const code = generateCode(RFC_SECRET_B32, now + 30);
    expect(verifyCode(RFC_SECRET_B32, code, 1, now)).toEqual({
      ok: true,
      counter: Math.floor((now + 30) / 30),
    });
  });

  it('rejects a two-windows-old code with default slop', () => {
    const now = 1234567890;
    const code = generateCode(RFC_SECRET_B32, now - 60);
    expect(verifyCode(RFC_SECRET_B32, code, 1, now).ok).toBe(false);
  });

  it('rejects non-numeric input', () => {
    const now = 1234567890;
    expect(verifyCode(RFC_SECRET_B32, 'abc123', 1, now).ok).toBe(false);
    expect(verifyCode(RFC_SECRET_B32, '12345', 1, now).ok).toBe(false);
    expect(verifyCode(RFC_SECRET_B32, '1234567', 1, now).ok).toBe(false);
    expect(verifyCode(RFC_SECRET_B32, '', 1, now).ok).toBe(false);
  });

  it('rejects a code from a different secret', () => {
    const now = 1234567890;
    const otherSecret = base32Encode(Buffer.from('OTHER-SECRET-20-BYTES', 'ascii').subarray(0, 20));
    const code = generateCode(otherSecret, now);
    expect(verifyCode(RFC_SECRET_B32, code, 1, now).ok).toBe(false);
  });
});

describe('generateSecretBase32', () => {
  it('returns a 160-bit secret encoded as 32 base32 chars from the RFC alphabet', () => {
    const s = generateSecretBase32();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    // decodable back to 20 bytes
    expect(base32Decode(s).length).toBe(20);
  });

  it('produces distinct secrets on successive calls', () => {
    const a = generateSecretBase32();
    const b = generateSecretBase32();
    expect(a).not.toBe(b);
  });
});

describe('otpauthUrl', () => {
  it('formats the RFC 5804 otpauth URI with SHA1/6/30 defaults', () => {
    const url = otpauthUrl('alice', 'JBSWY3DPEHPK3PXP');
    expect(url).toBe(
      'otpauth://totp/Athena%3Aalice?secret=JBSWY3DPEHPK3PXP&issuer=Athena&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('URL-encodes usernames with special characters', () => {
    const url = otpauthUrl('a b@c', 'JBSWY3DPEHPK3PXP');
    expect(url).toContain('Athena%3Aa%20b%40c');
  });
});

describe('recovery codes', () => {
  it('generateRecoveryCode returns xxxx-xxxx from the base32 alphabet', () => {
    for (let i = 0; i < 20; i++) {
      const c = generateRecoveryCode();
      expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
  });

  it('normalizeRecoveryCode strips separators and uppercases', () => {
    expect(normalizeRecoveryCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeRecoveryCode('ABCD EFGH')).toBe('ABCDEFGH');
    expect(normalizeRecoveryCode('ABCDEFGH')).toBe('ABCDEFGH');
    expect(normalizeRecoveryCode('abcd_efgh')).toBe('ABCDEFGH');
  });
});

describe('totp-crypto envelope', () => {
  const key = totpKey('a-long-session-secret-for-testing');
  const otherKey = totpKey('a-DIFFERENT-session-secret');
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

  it('round-trips a base32 secret', () => {
    const stored = encryptTotpSecret(key, 42, secret);
    expect(decryptTotpSecret(key, 42, stored)).toBe(secret);
  });

  it('two encryptions of the same input differ (unique nonces)', () => {
    const a = encryptTotpSecret(key, 42, secret);
    const b = encryptTotpSecret(key, 42, secret);
    expect(a).not.toBe(b);
    // but both decrypt to the same plaintext
    expect(decryptTotpSecret(key, 42, a)).toBe(secret);
    expect(decryptTotpSecret(key, 42, b)).toBe(secret);
  });

  it('fails auth when decrypted with a different session secret', () => {
    const stored = encryptTotpSecret(key, 42, secret);
    expect(() => decryptTotpSecret(otherKey, 42, stored)).toThrow();
  });

  it("fails auth when decrypted under a different user id (AAD binding)", () => {
    const stored = encryptTotpSecret(key, 42, secret);
    expect(() => decryptTotpSecret(key, 99, stored)).toThrow();
  });

  it('fails on a truncated envelope', () => {
    const stored = encryptTotpSecret(key, 42, secret);
    const truncated = Buffer.from(stored, 'base64').subarray(0, 10).toString('base64');
    expect(() => decryptTotpSecret(key, 42, truncated)).toThrow();
  });

  it('fails on a tampered ciphertext', () => {
    const stored = encryptTotpSecret(key, 42, secret);
    const buf = Buffer.from(stored, 'base64');
    // flip a byte in the middle (ciphertext region)
    buf[20] = buf[20]! ^ 0xff;
    expect(() => decryptTotpSecret(key, 42, buf.toString('base64'))).toThrow();
  });
});
