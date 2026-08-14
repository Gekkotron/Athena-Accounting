import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userSettings } from '../../db/schema.js';
import { mergeSettings } from './schema.js';

// Shared accessor for the single settings field report routes need:
// the manual-FX display currency. `null` means per-currency mode (no
// conversion) — see domain/settings/defaults.ts.
export async function loadUserDisplayCurrency(uid: number): Promise<string | null> {
  const [row] = await db
    .select({ settings: userSettings.settings })
    .from(userSettings)
    .where(eq(userSettings.userId, uid));
  const merged = mergeSettings(row?.settings ?? {});
  return merged.displayCurrency;
}
