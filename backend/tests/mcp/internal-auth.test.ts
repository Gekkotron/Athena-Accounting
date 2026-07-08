import { describe, it, expect, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('internal-dispatch auth', () => {
  let app: FastifyInstance;
  let uid: number;
  beforeAll(async () => {
    const { buildApp } = await import('../helpers/build-app.js');
    app = await buildApp();
    const onboard = await app.inject({ method: 'POST', url: '/api/onboarding/create', payload: { username: 'iauth', password: 'iauth-1234' } });
    uid = onboard.json().user?.id ?? (await (async () => {
      const { db } = await import('../../src/db/client.js');
      const { users } = await import('../../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      const [u] = await db.select().from(users).where(eq(users.username, 'iauth'));
      return u.id;
    })());
  });

  it('valid internal headers authenticate as the given uid', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/settings',
      headers: { 'x-athena-internal-auth': app.internalAuthSecret, 'x-athena-internal-uid': String(uid) },
    });
    expect(res.statusCode).toBe(200);
  });

  it('wrong internal secret is rejected (401)', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/settings',
      headers: { 'x-athena-internal-auth': 'deadbeef', 'x-athena-internal-uid': String(uid) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('absent internal headers are rejected (401)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(401);
  });
});
