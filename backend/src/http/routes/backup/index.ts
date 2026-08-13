import type { FastifyInstance } from 'fastify';
import { registerExportRoute } from './export.js';
import { registerRestoreRoute } from './restore.js';
import { registerDestinationRoutes } from './destination.js';
import { registerAttachmentsArchiveRoutes } from './attachments-archive.js';

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);
  registerExportRoute(app);
  registerRestoreRoute(app);
  registerDestinationRoutes(app);
  registerAttachmentsArchiveRoutes(app);
}
