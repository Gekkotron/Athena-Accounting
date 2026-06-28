import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../env.js';

// Bootstrap migration runner — applies *.sql files from ./migrations in
// lexicographic order, tracked in a `schema_migrations` table.
// Each file is run inside its own transaction so a failure rolls back cleanly.
// Idempotent: already-applied files are skipped.
export async function runMigrations(): Promise<void> {
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

  try {
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

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    console.log('[migrate] all migrations applied');
  } finally {
    await pool.end();
  }
}
