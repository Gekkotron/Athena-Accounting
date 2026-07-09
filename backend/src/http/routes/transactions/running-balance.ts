export interface BalanceRow {
  id: number;
  amount: string;
}

/**
 * Running balance per transaction for a SINGLE account.
 *
 * `rows` MUST be the account's FULL history, already ordered chronologically
 * by (date asc, id asc) — the caller owns that ordering. Money is summed in
 * integer cents to avoid float drift, then formatted back to a 2-dp string.
 *
 * Returns Map<txId, balanceString>, where the balance is
 * `openingBalance + Σ amounts up to and including that row`.
 */
export function computeRunningBalances(
  rows: BalanceRow[],
  openingBalance: string,
): Map<number, string> {
  const toCents = (s: string): number => Math.round(Number(s) * 100);
  let acc = toCents(openingBalance);
  const out = new Map<number, string>();
  for (const r of rows) {
    acc += toCents(r.amount);
    out.set(r.id, (acc / 100).toFixed(2));
  }
  return out;
}
