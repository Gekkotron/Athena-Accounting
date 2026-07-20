import type { FastifyInstance } from 'fastify';
import { registerCreate } from './create.js';
import { registerList } from './list.js';
import { registerPatch } from './patch.js';
import { registerBulk } from './bulk.js';
import { registerDelete } from './delete.js';
import { registerDuplicateRoutes } from './duplicates.js';
import { registerSplitsRoutes } from './splits.js';

export async function transactionsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  registerCreate(app);
  registerDuplicateRoutes(app);
  registerSplitsRoutes(app);
  registerList(app);
  registerPatch(app);
  registerBulk(app);
  registerDelete(app);
}
