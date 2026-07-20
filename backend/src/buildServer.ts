import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import { pool } from './db/client.js';
import { authPlugin } from './http/plugins/auth.js';
import { onboardingRoutes } from './http/routes/onboarding.js';
import { authRoutes } from './http/routes/auth.js';
import { mcpRpcRoutes } from './http/routes/mcp/index.js';
import { accountsRoutes } from './http/routes/accounts.js';
import { patternRoutes } from './http/routes/account-patterns.js';
import { importsRoutes } from './http/routes/imports.js';
import { importsPreviewRoutes } from './http/routes/imports-preview.js';
import { categoriesRoutes } from './http/routes/categories.js';
import { startDraftSweeper } from './domain/imports/pdf/draft-sweeper.js';
import { rulesRoutes } from './http/routes/rules.js';
import { transferRulesRoutes } from './http/routes/transfer-rules.js';
import { transactionsRoutes } from './http/routes/transactions/index.js';
import { reportsRoutes } from './http/routes/reports/index.js';
import { triRoutes } from './http/routes/tri.js';
import { backupRoutes } from './http/routes/backup/index.js';
import { pdfTemplatesRoutes } from './http/routes/pdf-templates.js';
import { balanceCheckpointsRoutes } from './http/routes/balance-checkpoints.js';
import { settingsRoutes } from './http/routes/settings.js';
import { tipsRoutes } from './http/routes/tips/index.js';
import { mcpSettingsRoutes } from './http/routes/mcp-settings.js';
import { budgetsRoutes } from './http/routes/budgets.js';
import { envelopesRoutes } from './http/routes/envelopes.js';
import { reconcileRoutes } from './http/routes/reconcile.js';
import { recurringRoutes } from './http/routes/recurring.js';
import { metricsPlugin } from './http/plugins/metrics.js';

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
  // Rate limiting. Global default is permissive (300 req/min) — the actual
  // protection is the per-route config on /api/auth/login and
  // /api/onboarding/create, which are stricter. Keyed on the client IP.
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(metricsPlugin);
  await app.register(authPlugin);

  // Public routes (no auth required to discover / complete onboarding, or log in).
  await app.register(onboardingRoutes);
  await app.register(authRoutes);
  // /api/mcp/rpc performs its own crypto-based auth (see mcp/index.ts), so it
  // belongs with the public routes rather than the requireAuth-gated block.
  await app.register(mcpRpcRoutes);

  // Authenticated routes (preHandler enforced inside each plugin via addHook).
  await app.register(accountsRoutes);
  await app.register(patternRoutes);
  await app.register(importsRoutes);
  await app.register(importsPreviewRoutes);
  await app.register(categoriesRoutes);
  await app.register(rulesRoutes);
  await app.register(transferRulesRoutes);
  await app.register(transactionsRoutes);
  await app.register(reportsRoutes);
  await app.register(triRoutes);
  await app.register(backupRoutes);
  await app.register(pdfTemplatesRoutes);
  await app.register(balanceCheckpointsRoutes);
  await app.register(settingsRoutes);
  await app.register(tipsRoutes);
  await app.register(mcpSettingsRoutes);
  await app.register(budgetsRoutes);
  await app.register(envelopesRoutes);
  await app.register(reconcileRoutes);
  await app.register(recurringRoutes);

  const serveStatic = env.SERVE_STATIC ?? env.NODE_ENV === 'production';
  if (serveStatic) {
    const root = env.STATIC_ROOT
      ? path.resolve(env.STATIC_ROOT)
      : path.resolve(process.cwd(), '..', 'frontend/dist');
    await app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && req.raw.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  startDraftSweeper(app);

  return app;
}
