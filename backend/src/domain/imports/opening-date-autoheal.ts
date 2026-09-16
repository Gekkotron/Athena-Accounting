import { and, eq } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { accounts } from '../../db/schema.js';
import { todayLocalIso } from '../../lib/dates.js';
import type { ParsedTransaction } from './ofx-parser.js';

// Runs inside the import transaction. Guards against a common footgun:
// user creates an account whose opening_date is today (default) or later,
// then imports historical transactions. The list-endpoint balance rollup
// sums only transactions where t.date >= a.opening_date, so all imported
// rows silently drop out and the account keeps reporting its
// opening_balance. When we detect this case, shift opening_date back to
// the earliest imported date so the sum picks them up.
//
// Only shifts when the CURRENT opening_date is today or in the future —
// an account whose opening_date is already in the past was deliberately
// started at a specific point (with a corresponding opening_balance that
// reflects reality on that date); rewriting its date would invalidate
// that factual claim. Extracted as a pure predicate so the guard logic
// is unit-testable independent of the transaction plumbing.
export function shouldShiftOpeningDate(
  acct: { openingDate: string },
  earliestDate: string,
  todayIso: string,
): boolean {
  return acct.openingDate >= todayIso && earliestDate < acct.openingDate;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = PgTransaction<any, any, any>;

export async function autoHealOpeningDate(
  tx: Tx,
  opts: { userId: number; accountId: number },
  parsed: ParsedTransaction[],
  trace: (msg: string) => void,
): Promise<void> {
  if (parsed.length === 0) return;
  const earliestDate = parsed.reduce(
    (min, p) => (p.date < min ? p.date : min),
    parsed[0]!.date,
  );
  const todayIso = todayLocalIso();
  const [acct] = await tx
    .select({ openingDate: accounts.openingDate })
    .from(accounts)
    .where(and(eq(accounts.id, opts.accountId), eq(accounts.userId, opts.userId)));
  if (!acct) return;
  if (!shouldShiftOpeningDate(acct, earliestDate, todayIso)) return;
  trace(
    `tx: shifting account.opening_date ${acct.openingDate} → ${earliestDate} ` +
    `(opening_date was today-or-future, historical import) account=${opts.accountId}`,
  );
  await tx
    .update(accounts)
    .set({ openingDate: earliestDate })
    .where(and(eq(accounts.id, opts.accountId), eq(accounts.userId, opts.userId)));
}
