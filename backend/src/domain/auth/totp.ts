import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 TOTP — HMAC-SHA1 over 8-byte counter, 6 digits, 30s period.
// Hand-rolled on node:crypto to keep the built-ins-only convention
// (mirrors backup/crypto.ts, bank-sync/crypto.ts). Compared to otplib:
// identical correctness for our narrow use, no transitive deps to audit.

const DIGITS = 6;
const PERIOD_S = 30;
const SECRET_BYTES = 20;

// RFC 4648 base32 alphabet, no padding needed on the wire — length is
// always a multiple of 8 chars for our fixed 160-bit secrets.
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function base32Decode(s: string): Buffer {
  const cleaned = s.replace(/=+$/, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecretBase32(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function generateCode(
  secretBase32: string,
  atUnixSec: number = Math.floor(Date.now() / 1000),
): string {
  const counter = Math.floor(atUnixSec / PERIOD_S);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const secret = base32Decode(secretBase32);
  const h = createHmac('sha1', secret).update(buf).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const binary =
    ((h[offset]! & 0x7f) << 24) |
    ((h[offset + 1]! & 0xff) << 16) |
    ((h[offset + 2]! & 0xff) << 8) |
    (h[offset + 3]! & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Accept the current window plus `windowSlop` on each side to tolerate
// clock skew between server and authenticator app. RFC 6238 §6 permits a
// small look-back-and-forward; ±1 (=60s each way) is the standard trade
// between usability and replay window. Returns the matched counter (the
// floor(unixSec/30) value at the offset that generated the accepted code)
// so callers can enforce the RFC 6238 §5.2 last-used-counter check —
// without it, a snooped code is replayable inside the acceptance window.
export function verifyCode(
  secretBase32: string,
  submitted: string,
  windowSlop: number = 1,
  nowUnixSec: number = Math.floor(Date.now() / 1000),
): { ok: boolean; counter: number } {
  if (!/^\d{6}$/.test(submitted)) return { ok: false, counter: 0 };
  for (let s = -windowSlop; s <= windowSlop; s++) {
    const atSec = nowUnixSec + s * PERIOD_S;
    if (timingSafeEqualStr(generateCode(secretBase32, atSec), submitted)) {
      return { ok: true, counter: Math.floor(atSec / PERIOD_S) };
    }
  }
  return { ok: false, counter: 0 };
}

export function otpauthUrl(username: string, base32Secret: string, issuer: string = 'Athena'): string {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Human-readable recovery codes: 5 random bytes → 8 base32 chars → split
// as xxxx-xxxx. RFC 4648's alphabet already omits 0/O/1/I/L. The dash is
// visual sugar; the server strips non-alphanumerics before matching.
export function generateRecoveryCode(): string {
  const raw = base32Encode(randomBytes(5)); // 40 bits → 8 chars
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
