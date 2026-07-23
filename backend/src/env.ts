import { z } from 'zod';

const boolish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    // Selects the SQL backend. `postgres` (default) drives a real Postgres via
    // pg.Pool + drizzle-orm/node-postgres. `pglite` drives an embedded
    // Postgres-in-WASM via @electric-sql/pglite + drizzle-orm/pglite — used
    // for the Tauri desktop distribution and for a docker-free test path.
    DB_DRIVER: z.enum(['postgres', 'pglite']).default('postgres'),
    // Selects the auth model. `session` (default) is the LAN/Docker path:
    // cookie + @fastify/session + argon2id passwords, users register through
    // `/api/onboarding/create`. `none` is the Tauri desktop path: no cookies,
    // no login round-trip — every request is authenticated as a single
    // hard-coded local user seeded on first boot. Never enable `none` on a
    // deployment that isn't strictly loopback-only.
    AUTH_MODE: z.enum(['session', 'none']).default('session'),
    // Required only for `postgres`. For `pglite` we default to an in-memory
    // DB unless PGLITE_PATH is set (then a filesystem-backed PGlite is used).
    DATABASE_URL: z.string().url().optional(),
    PGLITE_PATH: z.string().optional(),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    // Optional bearer token for /metrics. When set, the endpoint requires
    // `Authorization: Bearer <token>` and rejects everything else with 401.
    // When empty, the endpoint stays open — a startup warning is logged so
    // operators know to configure it before exposing the app beyond the LAN.
    // Prometheus scrapers can pass the token via `bearer_token`/`bearer_token_file`.
    METRICS_TOKEN: z.string().min(16).optional(),
    // Default false because self-hosted LAN deployments typically run over plain
    // HTTP. Set to true when running behind an HTTPS-terminating reverse proxy.
    COOKIE_SECURE: boolish.default(false),
    // When true (or NODE_ENV=production), Fastify also serves the built
    // frontend from `STATIC_ROOT` (default `<cwd>/frontend/dist`) at `/`,
    // so the same process answers both `/api/*` and the SPA. Used by the
    // Tauri desktop sidecar; Docker Compose keeps nginx in front.
    SERVE_STATIC: boolish.optional(),
    STATIC_ROOT: z.string().optional(),
  })
  .refine((v) => v.DB_DRIVER !== 'postgres' || !!v.DATABASE_URL, {
    message: 'DATABASE_URL is required when DB_DRIVER=postgres',
    path: ['DATABASE_URL'],
  });

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
