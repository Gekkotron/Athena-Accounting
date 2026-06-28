import Fastify from 'fastify';
import { env } from './env.js';
import { pool } from './db/client.js';
import { runMigrations } from './db/migrate.js';

const app = Fastify({
  logger:
    env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty' } }
      : true,
});

app.get('/health', async () => {
  // ping the DB so /health reflects end-to-end readiness, not just the process
  await pool.query('SELECT 1');
  return { ok: true, ts: new Date().toISOString() };
});

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
