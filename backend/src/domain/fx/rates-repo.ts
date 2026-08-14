import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { fxRates } from '../../db/schema.js';
import type { FxRate } from './types.js';

export async function loadUserRates(uid: number): Promise<FxRate[]> {
  const rows = await db
    .select({
      fromCcy: fxRates.fromCcy,
      toCcy: fxRates.toCcy,
      effectiveFrom: fxRates.effectiveFrom,
      rate: fxRates.rate,
    })
    .from(fxRates)
    .where(eq(fxRates.userId, uid));
  return rows.map((r) => ({
    fromCcy: r.fromCcy,
    toCcy: r.toCcy,
    effectiveFrom: String(r.effectiveFrom),
    rate: String(r.rate),
  }));
}
