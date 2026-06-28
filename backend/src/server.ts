import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { pool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { authPlugin } from './http/plugins/auth.js';
import { onboardingRoutes } from './http/routes/onboarding.js';
import { authRoutes } from './http/routes/auth.js';
import { accountsRoutes } from './http/routes/accounts.js';
import { patternRoutes } from './http/routes/account-patterns.js';
import { importsRoutes } from './http/routes/imports.js';

const app = Fastify({
  logger:
    env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty' } }
      : true,
});

app.get('/health', async () => {
  // Ping the DB so /health reflects end-to-end readiness, not just process liveness.
  await pool.query('SELECT 1');
  return { ok: true, ts: new Date().toISOString() };
});

await app.register(multipart);
await app.register(authPlugin);

// Public routes (no auth required to discover / complete onboarding, or log in).
await app.register(onboardingRoutes);
await app.register(authRoutes);

// Authenticated routes (preHandler enforced inside each plugin via addHook).
await app.register(accountsRoutes);
await app.register(patternRoutes);
await app.register(importsRoutes);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await pool.end();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'error during shutdown');
    process.exit(1);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

const start = async () => {
  try {
    await runMigrations();
    await app.listen({ host: '0.0.0.0', port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
