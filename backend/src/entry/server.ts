import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { pool } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { build } from '../buildServer.js';

const shutdown = async (app: FastifyInstance, signal: string) => {
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

const app = await build();

process.on('SIGINT', () => void shutdown(app, 'SIGINT'));
process.on('SIGTERM', () => void shutdown(app, 'SIGTERM'));

try {
  await runMigrations();
  if (!process.env.OCR_LANG_PATH) app.log.warn('OCR_LANG_PATH not set — first OCR run will attempt CDN fetch (fine for dev, fails on LAN-only deploy).');
  await app.listen({ host: '0.0.0.0', port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
