import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

// Uniform query surface that both drivers can implement — matches the subset
// of `pg.Pool` used outside Drizzle (metrics.ts, migrate.ts). PGlite's native
// `.query()` already returns `{ rows }` with the same row shape, so wrapping
// is a thin shim rather than a translation layer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QueryPool {
  // `any` default keeps the untyped call site (`const { rows } = await pool.query('...')`)
  // usable without a generic, matching how `pg.Pool.query` behaves today.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  // Multi-statement executor (no params). Needed for the migration runner —
  // pg.Pool.query happily accepts semicolon-separated statements, but PGlite
  // rejects them through `.query()` and requires `.exec()` instead.
  exec(text: string): Promise<void>;
  end(): Promise<void>;
}

function buildPostgres() {
  const p = new pg.Pool({ connectionString: env.DATABASE_URL });
  const d = drizzlePg(p, { schema });
  const wrapped: QueryPool = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: <T = any>(text: string, params?: unknown[]) =>
      p.query(text, params) as unknown as Promise<{ rows: T[] }>,
    exec: async (text) => {
      await p.query(text);
    },
    end: () => p.end(),
  };
  return { db: d, pool: wrapped };
}

async function buildPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { unaccent } = await import('@electric-sql/pglite/contrib/unaccent');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');

  const client = await PGlite.create({
    dataDir: env.PGLITE_PATH,
    extensions: { pg_trgm, unaccent, pgcrypto },
  });
  const d = drizzlePglite(client, { schema });
  const wrapped: QueryPool = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: async <T = any>(text: string, params?: unknown[]) => {
      const res = await client.query(text, (params ?? []) as unknown[]);
      return { rows: res.rows as T[] };
    },
    exec: async (text) => {
      await client.exec(text);
    },
    end: async () => {
      await client.close();
    },
  };
  return { db: d, pool: wrapped };
}

// Top-level await lets us return one uniform (`db`, `pool`) pair regardless of
// driver, so callers never see the driver split. Requires ES2022 + NodeNext,
// which tsconfig already enables.
const handles =
  env.DB_DRIVER === 'postgres' ? buildPostgres() : await buildPglite();

// Drizzle's `pglite` and `node-postgres` instances share the same query-builder
// surface used by the rest of the codebase; the internal shape differs, so we
// widen to the Postgres flavor for typing purposes.
export const db = handles.db as ReturnType<typeof buildPostgres>['db'];
export const pool: QueryPool = handles.pool;

export type DB = typeof db;
