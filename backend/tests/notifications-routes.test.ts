// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

const RUN = !!process.env.RUN_DB_TESTS;

let app: FastifyInstance;
let cookie: string;
let uid: number;

describe.skipIf(!RUN)('notifications routes', () => {
  beforeAll(async () => {
    const { buildApp } = await import('./helpers/build-app.js');
    const { seedUserAndCookie } = await import('./helpers/seedUserAndCookie.js');
    app = await buildApp();
    ({ cookie, uid } = await seedUserAndCookie(app));
  });

  afterAll(async () => { await app.close(); });

  it('rejects unauthenticated requests', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(r.statusCode).toBe(401);
  });

  // requireAuth's preHandler returns 401 before the SSE handler ever writes
  // to the raw response, so this is safe to check with app.inject — it never
  // opens the long-lived connection. See stream.ts / task-7-brief.md for why
  // the authenticated 200 case isn't covered here.
  it('rejects an unauthenticated stream request', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/notifications/stream' });
    expect(r.statusCode).toBe(401);
  });

  it('lists notifications with unread filter', async () => {
    const { emitNotification } = await import('../src/domain/notifications/emit.js');
    await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 'route-1' });
    const r = await app.inject({ method: 'GET', url: '/api/notifications?unread=1', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().items.length).toBeGreaterThan(0);
  });

  it('unread-count reports a number', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/notifications/unread-count', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(typeof r.json().count).toBe('number');
  });

  it('POST /:id/read marks read', async () => {
    const { emitNotification } = await import('../src/domain/notifications/emit.js');
    const emitted = await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 'route-2' });
    const r = await app.inject({ method: 'POST', url: `/api/notifications/${emitted!.id}/read`, headers: { cookie } });
    expect(r.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/notifications?unread=1', headers: { cookie } });
    expect(list.json().items.find((n: any) => n.id === emitted!.id)).toBeUndefined();
  });

  it('POST /read-all clears the unread count', async () => {
    const { emitNotification } = await import('../src/domain/notifications/emit.js');
    await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 'route-3' });
    const r = await app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: { cookie } });
    expect(r.statusCode).toBe(204);
    const count = await app.inject({ method: 'GET', url: '/api/notifications/unread-count', headers: { cookie } });
    expect(count.json().count).toBe(0);
  });

  it('DELETE /:id removes a notification', async () => {
    const { emitNotification } = await import('../src/domain/notifications/emit.js');
    const emitted = await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 'route-4' });
    const r = await app.inject({ method: 'DELETE', url: `/api/notifications/${emitted!.id}`, headers: { cookie } });
    expect(r.statusCode).toBe(204);
    const list = await app.inject({ method: 'GET', url: '/api/notifications', headers: { cookie } });
    expect(list.json().items.find((n: any) => n.id === emitted!.id)).toBeUndefined();
  });

  it('POST /test creates a real inbox row', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie } });
    expect(r.statusCode).toBe(201);
    expect(r.json().kind).toBe('test');
  });

  it('POST /test returns 422 and fires nothing when notifications are disabled', async () => {
    const { db } = await import('../src/db/client.js');
    const { userSettings, notifications } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    await db
      .insert(userSettings)
      .values({ userId: uid, settings: { notifications: { enabled: false } } })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { settings: { notifications: { enabled: false } } },
      });

    const before = await db.select().from(notifications).where(eq(notifications.userId, uid));
    const r = await app.inject({ method: 'POST', url: '/api/notifications/test', headers: { cookie } });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ error: 'notifications_disabled' });
    const after = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(after.length).toBe(before.length);

    // Restore for any tests that might run after this one in the file.
    await db
      .insert(userSettings)
      .values({ userId: uid, settings: { notifications: { enabled: true } } })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { settings: { notifications: { enabled: true } } },
      });
  });
});
