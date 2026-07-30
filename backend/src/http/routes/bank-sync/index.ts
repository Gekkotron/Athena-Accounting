import type { FastifyInstance } from 'fastify';
import { registerCredentials } from './credentials.js';
import { registerConsent } from './consent.js';
import { registerConnections } from './connections.js';

// Composer for the Enable Banking bank-sync surface. Split per concern
// (credentials / consent flow / connections + sync) like the accounts and
// transactions route folders.
export async function bankSyncRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);
  registerCredentials(app);
  registerConsent(app);
  registerConnections(app);
}
