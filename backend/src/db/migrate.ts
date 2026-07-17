import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client.js';

// Bootstrap migration runner — applies *.sql files from ./migrations in
// lexicographic order, tracked in a `schema_migrations` table.
// Each file is run inside its own transaction so a failure rolls back cleanly.
// Idempotent: already-applied files are skipped.
//
// Runs against whichever driver `client.ts` was built with (postgres or
// pglite). Both drivers expose the same `.query(text, params)` shape.
export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, './migrations');

  const entries = await readdir(migrationsDir);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const { rows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      [file],
    );
    if (rows.length > 0) continue;

    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    console.log(`[migrate] applying ${file}`);

    try {
      // PGlite rejects multi-statement bodies through `.query()`, so route
      // the raw migration SQL through `.exec()` — which is a plain
      // `pool.query()` on the Postgres path. Wrap in an explicit
      // transaction so a mid-file failure rolls back cleanly.
      await pool.query('BEGIN');
      await pool.exec(sql);
      await pool.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file],
      );
      await pool.query('COMMIT');
    } catch (err) {
      await pool.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  console.log('[migrate] all migrations applied');
}
