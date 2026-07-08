import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const RUN = !!process.env.RUN_DB_TESTS;

describe.skipIf(!RUN)('user_settings mcp columns', () => {
  let pool: import('pg').Pool;
  beforeAll(async () => {
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations();
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => { await pool.end(); });

  it('has mcp_enabled (default false) and mcp_key_wrapped columns', async () => {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'user_settings' AND column_name IN ('mcp_enabled','mcp_key_wrapped')
      ORDER BY column_name
    `);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName['mcp_enabled'].data_type).toBe('boolean');
    expect(byName['mcp_enabled'].column_default).toContain('false');
    expect(byName['mcp_key_wrapped'].is_nullable).toBe('YES');
  });
});
