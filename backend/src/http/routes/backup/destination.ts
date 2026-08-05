import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client.js';
import { userSettings } from '../../../db/schema.js';
import { env } from '../../../env.js';
import { userId } from '../../plugins/auth.js';
import { mergeSettings } from '../../../domain/settings/schema.js';
import { nextScheduledOccurrence } from '../../../domain/imports/bank-sync-core.js';
import { BackupProviderError, type BackupProvider } from '../../../domain/backup/providers.js';
import {
  BackupNotConfiguredError,
  providerFor,
  runBackupNow,
} from '../../../domain/backup/runner.js';
import {
  deleteDestination,
  getDestination,
  setDestination,
  type BackupDestinationRecord,
  type FolderConfig,
  type WebdavConfig,
} from '../../../domain/backup/store.js';

// Remote backup destination CRUD + run-now. Secrets (WebDAV password,
// backup passphrase) travel only in the PUT body and are never echoed by
// any response.

const shared = {
  keepLast: z.number().int().min(1).max(365).default(30),
  passphrase: z.string().min(8).max(1024),
  enabled: z.boolean().default(true),
};

const PutBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('webdav'),
    url: z
      .string()
      .url()
      .refine((u) => /^https?:\/\//.test(u), { message: 'http(s) URL required' }),
    username: z.string().trim().min(1),
    password: z.string().min(1),
    subdir: z.string().trim().optional(),
    ...shared,
  }),
  z.object({
    kind: z.literal('folder'),
    path: z.string().trim().min(1).refine(isAbsolute, { message: 'absolute path required' }),
    ...shared,
  }),
]);

async function backupHourFor(uid: number): Promise<number> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  return mergeSettings(row?.settings ?? {}).backupHour;
}

async function statusFor(uid: number, dest: BackupDestinationRecord | null) {
  const hour = await backupHourFor(uid);
  const autoEnabled = env.BACKUP_AUTO && env.NODE_ENV !== 'test';
  const auto = {
    enabled: autoEnabled,
    hour,
    nextAt:
      autoEnabled && dest?.enabled ? nextScheduledOccurrence(hour, new Date()).toISOString() : null,
  };
  if (!dest) return { configured: false as const, auto };
  return {
    configured: true as const,
    kind: dest.kind,
    // Non-secret by construction: url/username/subdir/path/keepLast.
    config: dest.config,
    enabled: dest.enabled,
    lastRunAt: dest.lastRunAt ? dest.lastRunAt.toISOString() : null,
    lastError: dest.lastError,
    auto,
  };
}

// Real write + delete against the destination before persisting anything —
// same philosophy as bank-sync validating credentials live. The probe name
// deliberately does NOT match the backup filename pattern, so it can never
// be counted or pruned as a backup.
async function probe(provider: BackupProvider): Promise<void> {
  const name = `.athena-destination-test-${randomUUID()}`;
  await provider.upload(name, Buffer.from('athena backup destination probe'));
  await provider.remove(name);
}

export function registerDestinationRoutes(app: FastifyInstance): void {
  app.get('/api/backup/destination', async (req: FastifyRequest) => {
    const uid = userId(req);
    return statusFor(uid, await getDestination(uid));
  });

  app.put('/api/backup/destination', async (req, reply) => {
    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const uid = userId(req);
    const body = parsed.data;
    const config: WebdavConfig | FolderConfig =
      body.kind === 'webdav'
        ? {
            url: body.url,
            username: body.username,
            subdir: body.subdir?.trim() || null,
            keepLast: body.keepLast,
          }
        : { path: body.path, keepLast: body.keepLast };
    const secret = body.kind === 'webdav' ? body.password : null;
    const candidate: BackupDestinationRecord = {
      kind: body.kind,
      config,
      secret,
      passphrase: body.passphrase,
      enabled: body.enabled,
      lastRunAt: null,
      lastError: null,
    };
    try {
      await probe(providerFor(candidate));
    } catch (err) {
      const detail =
        err instanceof BackupProviderError || err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: 'destination test failed', detail });
    }
    await setDestination(uid, {
      kind: body.kind,
      config,
      secret,
      passphrase: body.passphrase,
      enabled: body.enabled,
    });
    return statusFor(uid, await getDestination(uid));
  });

  app.delete('/api/backup/destination', async (req) => {
    await deleteDestination(userId(req));
    return { configured: false };
  });

  app.post('/api/backup/destination/run-now', async (req, reply) => {
    try {
      return await runBackupNow(userId(req));
    } catch (err) {
      if (err instanceof BackupNotConfiguredError) {
        return reply.code(409).send({ error: 'backup destination not configured' });
      }
      const detail = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: 'backup failed', detail });
    }
  });
}
