// Perf-audit regression guard for the @fastify/compress registration.
// The plugin is registered early in buildServer.ts with encodings
// ['br', 'gzip'] and threshold 1024 — the byte-size cutoff below which
// the CPU cost of compressing outweighs the wire savings. This test
// hits a JSON list route with a large-enough payload while advertising
// `accept-encoding: br` and asserts the response comes back
// pre-compressed with `content-encoding: br`.
// Requires RUN_DB_TESTS=1.
import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = process.env.RUN_DB_TESTS === '1';
const d = RUN ? describe : describe.skip;

let app: FastifyInstance;
let cookie: string;

d('response compression', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    app = await buildApp();
    await app.inject({
      method: 'POST', url: '/api/onboarding/create',
      payload: { username: 'compress-user', password: 'compress-1234' },
    });
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'compress-user', password: 'compress-1234' },
    });
    cookie = login.cookies[0]!.name + '=' + login.cookies[0]!.value;
  });

  it('brotli-compresses a JSON list response above the 1024-byte threshold', async () => {
    // Seed enough rules for the /api/rules response to comfortably clear
    // the 1024-byte compression threshold. Each rule row serializes to
    // ~200 bytes; 30 rows lands well over 1 kB.
    const { db } = await import('../src/db/client.js');
    const { rules, categories, users } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    const [u] = await db.select().from(users).where(eq(users.username, 'compress-user'));
    const [cat] = await db.select().from(categories).where(eq(categories.userId, u!.id)).limit(1);
    await db.insert(rules).values(
      Array.from({ length: 30 }, (_, i) => ({
        userId: u!.id,
        categoryId: cat!.id,
        keyword: `compress-keyword-${i.toString().padStart(3, '0')}-with-extra-padding`,
        signConstraint: 'any' as const,
        matchMode: 'substring' as const,
        priority: 100,
        enabled: true,
      })),
    );

    const res = await app.inject({
      method: 'GET', url: '/api/rules',
      headers: { cookie, 'accept-encoding': 'br' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('br');
    // Vary: Accept-Encoding is what tells caches (nginx, Cloudflare, the
    // browser cache) that the same URL has different bytes per client's
    // Accept-Encoding — omitting it would poison caches with the wrong
    // representation. @fastify/compress sets it automatically.
    expect(String(res.headers['vary'] ?? '')).toMatch(/Accept-Encoding/i);
  });

  it('falls back to gzip when the client advertises only gzip', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/rules',
      headers: { cookie, 'accept-encoding': 'gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it('skips compression entirely for sub-1024-byte payloads', async () => {
    // /health returns ~120 bytes — well under the threshold.
    const res = await app.inject({
      method: 'GET', url: '/health',
      headers: { 'accept-encoding': 'br' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
  });
});
