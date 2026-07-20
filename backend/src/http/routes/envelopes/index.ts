// Envelope-mode budgeting routes. Independent of /api/budgets — the two
// modes do not share tables. See docs/superpowers/specs/2026-07-16-budget-modes-design.md.
import type { FastifyInstance } from 'fastify';
import { registerAssignmentRoutes } from './assignments.js';
import { registerReallocateRoute } from './reallocate.js';
import { registerSettingsRoutes } from './settings.js';
import { registerHoldsRoutes } from './holds.js';
import { registerReportRoute } from './report.js';

export async function envelopesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);
  registerAssignmentRoutes(app);
  registerReallocateRoute(app);
  registerSettingsRoutes(app);
  registerHoldsRoutes(app);
  registerReportRoute(app);
}
