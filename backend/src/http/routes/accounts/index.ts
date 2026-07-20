import type { FastifyInstance } from 'fastify';
import { registerList } from './list.js';
import { registerReorder } from './reorder.js';
import { registerCrud } from './crud.js';
import { registerMerge } from './merge.js';

export async function accountsRoutes(app: FastifyInstance): Promise<void> {
  // Every route in this plugin requires auth.
  app.addHook('preHandler', app.requireAuth);

  registerList(app);
  registerReorder(app);
  registerCrud(app);
  registerMerge(app);
}
