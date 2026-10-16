import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { loans } from '../../../db/schema.js';
import type { BackupDump } from './schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Two passes so the self-referencing FK can never trip on row order:
// insert every loan with source_loan_id NULL, then re-link simulations to
// their source by name. Returns the inserted count.
export async function restoreLoans(
  tx: Tx,
  uid: number,
  dumpLoans: NonNullable<BackupDump['loans']>,
): Promise<number> {
  if (dumpLoans.length === 0) return 0;
  const inserted = await tx
    .insert(loans)
    .values(dumpLoans.map((l) => {
      const { sourceLoan, createdAt, updatedAt, ...rest } = l;
      void sourceLoan; // re-linked in the second pass below
      return {
        ...rest,
        userId: uid,
        sourceLoanId: null,
        ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
        ...(updatedAt ? { updatedAt: new Date(updatedAt) } : {}),
      };
    }))
    .returning({ id: loans.id, name: loans.name });
  const idByName = new Map(inserted.map((r) => [r.name, r.id]));
  for (const l of dumpLoans) {
    if (l.sourceLoan === null) continue;
    const sourceId = idByName.get(l.sourceLoan);
    const selfId = idByName.get(l.name);
    if (sourceId === undefined || selfId === undefined) continue;
    await tx
      .update(loans)
      .set({ sourceLoanId: sourceId })
      .where(and(eq(loans.id, selfId), eq(loans.userId, uid)));
  }
  return inserted.length;
}
