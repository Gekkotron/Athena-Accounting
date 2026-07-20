import { eq } from 'drizzle-orm';
import { db as realDb } from '../../../db/client.js';
import { userSettings } from '../../../db/schema.js';
import { TIP_IDS } from './tip-ids.js';

export interface CleanupDeps {
  select: () => Promise<Array<{ userId: number; dismissedTips: Record<string, string> | null }>>;
  updateDismissed: (userId: number, blob: Record<string, string>) => Promise<void>;
}

// Pure function — takes deps so the test can pass a fake db. The default
// binding (below) uses the real drizzle client. On boot we log
// `{ scanned, mutated }`; we don't fail the boot on cleanup errors —
// the app still functions with a stale blob (unknown keys are just
// ignored client-side).
export async function cleanupOrphanTipIds(deps: CleanupDeps): Promise<{ scanned: number; mutated: number }> {
  const rows = await deps.select();
  const allowed = new Set<string>(TIP_IDS);
  let mutated = 0;
  for (const row of rows) {
    if (row.dismissedTips == null) continue;
    const kept: Record<string, string> = {};
    let dropped = 0;
    for (const [k, v] of Object.entries(row.dismissedTips)) {
      if (allowed.has(k)) kept[k] = v;
      else dropped++;
    }
    if (dropped === 0) continue;
    await deps.updateDismissed(row.userId, kept);
    mutated++;
  }
  return { scanned: rows.length, mutated };
}

// Real binding — reads every row of user_settings, updates in place.
// Called once at server boot from buildServer.ts.
export async function runOrphanCleanup(): Promise<{ scanned: number; mutated: number }> {
  return cleanupOrphanTipIds({
    select: async () => {
      const rows = await realDb
        .select({ userId: userSettings.userId, dismissedTips: userSettings.dismissedTips })
        .from(userSettings);
      return rows.map((r) => ({
        userId: r.userId as number,
        dismissedTips: (r.dismissedTips as Record<string, string> | null) ?? null,
      }));
    },
    updateDismissed: async (userId, blob) => {
      await realDb
        .update(userSettings)
        .set({ dismissedTips: blob })
        .where(eq(userSettings.userId, userId as number));
    },
  });
}
