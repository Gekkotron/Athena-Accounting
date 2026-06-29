import Fastify, { type FastifyInstance } from 'fastify';
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
import { categoriesRoutes } from './http/routes/categories.js';
import { startDraftSweeper } from './domain/imports/pdf/draft-sweeper.js';
import { rulesRoutes } from './http/routes/rules.js';
import { transferRulesRoutes } from './http/routes/transfer-rules.js';
import { transactionsRoutes } from './http/routes/transactions.js';
import { reportsRoutes } from './http/routes/reports.js';
import { triRoutes } from './http/routes/tri.js';
import { backupRoutes } from './http/routes/backup.js';
import { pdfTemplatesRoutes } from './http/routes/pdf-templates.js';

export async function build(opts?: { logger?: boolean }): Promise<FastifyInstance> {
  const logger = opts?.logger === false
    ? false
    : (env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : true);
  const app = Fastify({ logger });

  app.get('/health', async () => {
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
  await app.register(categoriesRoutes);
  await app.register(rulesRoutes);
  await app.register(transferRulesRoutes);
  await app.register(transactionsRoutes);
  await app.register(reportsRoutes);
  await app.register(triRoutes);
  await app.register(backupRoutes);
  await app.register(pdfTemplatesRoutes);

  startDraftSweeper(app);

  return app;
}

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

if (env.NODE_ENV !== 'test') {
  const app = await build();

  process.on('SIGINT', () => void shutdown(app, 'SIGINT'));
  process.on('SIGTERM', () => void shutdown(app, 'SIGTERM'));

  try {
    await runMigrations();
    await app.listen({ host: '0.0.0.0', port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
