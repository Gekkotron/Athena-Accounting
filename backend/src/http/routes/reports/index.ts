import type { FastifyInstance } from 'fastify';
import { registerBalanceRoute } from './balance.js';
import { registerTimeseriesRoute } from './timeseries.js';
import { registerCategoriesReportRoute } from './categories.js';
import { registerBudgetRoute } from './budget.js';

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);
  registerBalanceRoute(app);
  registerTimeseriesRoute(app);
  registerCategoriesReportRoute(app);
  registerBudgetRoute(app);
}
