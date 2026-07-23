import { timingSafeEqual } from 'node:crypto';

// Timing-safe Bearer-token comparison used by GET /metrics. Kept in its own
// module so unit tests can import it without dragging in the DB pool / env
// (which would refuse to initialize without DATABASE_URL).
export function bearerTokenMatches(header: string | undefined, expected: string): boolean {
  const prefix = 'Bearer ';
  const supplied = header && header.startsWith(prefix) ? header.slice(prefix.length) : '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
