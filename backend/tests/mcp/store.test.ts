import { describe, it, expect, beforeAll, afterEach } from 'vitest';
const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('mcp store', () => {
  let uid: number;
  beforeAll(async () => {
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations();
    const { db } = await import('../../src/db/client.js');
    const { users } = await import('../../src/db/schema.js');
    await db.delete(users);
    const [u] = await db.insert(users).values({ username: 'storeuser', passwordHash: 'x' }).returning();
    uid = u.id;
  });
  afterEach(async () => {
    const { db } = await import('../../src/db/client.js');
    const { userSettings } = await import('../../src/db/schema.js');
    await db.delete(userSettings);
  });

  it('defaults: no row → disabled, no token', async () => {
    const s = await import('../../src/domain/mcp/store.js');
    expect(await s.getMcpState(uid)).toEqual({ enabled: false, hasToken: false });
    expect(await s.getMcpByUsername('storeuser')).toEqual({ userId: uid, enabled: false, keyWrapped: null });
  });

  it('setMcpEnabled + setMcpWrappedKey upsert and read back', async () => {
    const s = await import('../../src/domain/mcp/store.js');
    await s.setMcpEnabled(uid, true);
    await s.setMcpWrappedKey(uid, 'WRAPPED');
    expect(await s.getMcpState(uid)).toEqual({ enabled: true, hasToken: true });
    const byName = await s.getMcpByUsername('storeuser');
    expect(byName).toEqual({ userId: uid, enabled: true, keyWrapped: 'WRAPPED' });
  });

  it('setMcpWrappedKey(null) revokes', async () => {
    const s = await import('../../src/domain/mcp/store.js');
    await s.setMcpWrappedKey(uid, 'WRAPPED');
    await s.setMcpWrappedKey(uid, null);
    expect(await s.getMcpState(uid)).toEqual({ enabled: false, hasToken: false });
  });

  it('getMcpByUsername returns null for unknown user', async () => {
    const s = await import('../../src/domain/mcp/store.js');
    expect(await s.getMcpByUsername('nope')).toBeNull();
  });
});
