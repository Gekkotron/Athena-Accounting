// requires Postgres — run with RUN_DB_TESTS=1
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';

const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('emitNotification (db)', () => {
  let uid: number;

  beforeEach(async () => {
    const { seedUser } = await import('../../../../tests/helpers/seedUser.js');
    const { db } = await import('../../../db/client.js');
    const { notifications } = await import('../../../db/schema.js');
    uid = await seedUser();
    await db.delete(notifications).where(eq(notifications.userId, uid));
  });

  it('persists a row and returns it', async () => {
    const { emitNotification } = await import('../emit.js');
    const { db } = await import('../../../db/client.js');
    const { notifications } = await import('../../../db/schema.js');
    const row = await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 't1' });
    expect(row).not.toBeNull();
    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(rows).toHaveLength(1);
  });

  it('is idempotent on repeat idempotency key', async () => {
    const { emitNotification } = await import('../emit.js');
    const { db } = await import('../../../db/client.js');
    const { notifications } = await import('../../../db/schema.js');
    await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 't2' });
    const second = await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 't2' });
    expect(second).toBeNull();
    const rows = await db.select().from(notifications).where(eq(notifications.userId, uid));
    expect(rows).toHaveLength(1);
  });

  it('short-circuits when master switch is off', async () => {
    const { db } = await import('../../../db/client.js');
    const { userSettings } = await import('../../../db/schema.js');
    await db
      .insert(userSettings)
      .values({ userId: uid, settings: { notifications: { enabled: false } } })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { settings: { notifications: { enabled: false } } },
      });

    const { emitNotification } = await import('../emit.js');
    const row = await emitNotification(uid, 'test', { kind: 'test' }, { idempotency: 't3' });
    expect(row).toBeNull();
  });
});
