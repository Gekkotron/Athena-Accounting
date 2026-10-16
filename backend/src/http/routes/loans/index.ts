import type { FastifyInstance } from 'fastify';
import { registerList } from './list.js';
import { registerCrud } from './crud.js';
import { registerSimulate } from './simulate.js';

export async function loansRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);
  registerList(app);
  registerSimulate(app);
  registerCrud(app);
}
