import { createHmac } from 'node:crypto';

// Hand-rolled RFC 6238 TOTP for the e2e suite. Mirrors the backend's
// implementation in backend/src/domain/auth/totp.ts, on purpose — we do
// not want the spec importing across the backend/frontend boundary just
// to compute a 6-digit code, and the production route that would expose
// the current server code is gated on NODE_ENV=test (the fullstack
// harness runs the backend in production mode, so the debug route is
// absent). Because both server and spec sample real wall-clock time in
// the same 30-second window, a freshly generated code matches on submit.

const RFC4648_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const cleaned = input.trim().toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of cleaned) {
    const value = RFC4648_BASE32.indexOf(ch);
    if (value < 0) throw new Error(`invalid base32 char: ${ch}`);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(
  secretBase32: string,
  atUnixSec: number = Math.floor(Date.now() / 1000),
): string {
  const counter = Math.floor(atUnixSec / 30);
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
  return (binary % 1_000_000).toString().padStart(6, '0');
}
