import type { FastifyInstance } from 'fastify';
import { registerList } from './list.js';
import { registerCrud } from './crud.js';
import { registerEvents } from './events.js';

export async function savingsGoalsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);
  registerList(app);
  registerCrud(app);
  registerEvents(app);
}
