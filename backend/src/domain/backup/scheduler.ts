import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../../db/client.js';
import { userSettings } from '../../db/schema.js';
import { env } from '../../env.js';
import { lastScheduledOccurrence } from '../imports/bank-sync-core.js';
import { mergeSettings } from '../settings/schema.js';
import { listEnabledDestinations } from './store.js';
import { runBackupNow } from './runner.js';

// Unattended remote backup at the user-configured local hour
// (settings.backupHour, default 03:00). Same tick pattern as the bank-sync
// scheduler: 15-min interval, boot-delayed, overlap-guarded, unref'd,
// cleared onClose, disabled with BACKUP_AUTO=0 and never active under
// tests. Dueness is persistent (backup_destinations.last_run_at, which
// only moves on success) — at most one backup per user per day, and a
// failed run retries on the next tick rather than waiting for tomorrow.
const TICK_INTERVAL_MS = 15 * 60_000;
const BOOT_DELAY_MS = 5 * 60_000;

export function isBackupDue(hour: number, now: Date, lastRunAt: Date | null): boolean {
  return (lastRunAt?.getTime() ?? 0) < lastScheduledOccurrence(hour, now).getTime();
}

async function backupHourFor(uid: number): Promise<number> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  return mergeSettings(row?.settings ?? {}).backupHour;
}

export function startBackupScheduler(app: FastifyInstance): void {
  if (env.NODE_ENV === 'test' || !env.BACKUP_AUTO) return;
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void (async () => {
      const now = new Date();
      for (const { userId, lastRunAt } of await listEnabledDestinations()) {
        if (!isBackupDue(await backupHourFor(userId), now, lastRunAt)) continue;
        try {
          const { filename } = await runBackupNow(userId);
          app.log.info(`[backup] user=${userId} pushed ${filename}`);
        } catch (err) {
          // runBackupNow already recorded lastError; keep the tick alive.
          app.log.error({ err }, `[backup] user=${userId} scheduled backup failed`);
        }
      }
    })()
      .catch((err) => app.log.error({ err }, '[backup] scheduler tick failed'))
      .finally(() => {
        running = false;
      });
  };
  const boot = setTimeout(tick, BOOT_DELAY_MS);
  boot.unref();
  const handle = setInterval(tick, TICK_INTERVAL_MS);
  handle.unref();
  app.addHook('onClose', async () => {
    clearTimeout(boot);
    clearInterval(handle);
  });
}
