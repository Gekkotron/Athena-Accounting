// Pure envelope-budgeting math. No I/O, no DB, no Drizzle types — takes
// plain records and returns plain records. See spec §Semantics for the
// formulas this file implements verbatim.

export type Money = string;

export interface AssignmentRow {
  categoryId: number;
  month: string;     // "YYYY-MM-01"
  amount: Money;     // signed decimal string
}

export interface SpendRow {
  categoryId: number;
  month: string;
  amount: Money;     // always >= 0 in normal use
}

export interface PolicyRow {
  categoryId: number;
  overspendPolicy: 'rollover_negative' | 'reallocate_manual';
}

// Money arithmetic — use cents-integer math internally, format back to
// "X.YY" on the way out. Everything is stored as NUMERIC(14,2) in PG,
// so cents fits in a JS number (safe up to 2^53).
const toCents = (m: Money): number => Math.round(Number(m) * 100);
const fromCents = (c: number): Money => (c / 100).toFixed(2);

const monthKey = (m: string): string => m.slice(0, 7);
const compareMonth = (a: string, b: string): number => monthKey(a).localeCompare(monthKey(b));

export function computeCategoryBalances(
  upToMonth: string,
  assignments: AssignmentRow[],
  spends: SpendRow[],
  policies: PolicyRow[],
): Map<number, { balance: Money; absorbedByPool: Money; overspent: boolean }> {
  const policyBy = new Map(policies.map((p) => [p.categoryId, p.overspendPolicy]));
  const catIds = new Set<number>([
    ...assignments.map((a) => a.categoryId),
    ...spends.map((s) => s.categoryId),
  ]);
  const out = new Map<number, { balance: Money; absorbedByPool: Money; overspent: boolean }>();

  for (const catId of catIds) {
    const catAssigns = assignments
      .filter((a) => a.categoryId === catId && compareMonth(a.month, upToMonth) <= 0)
      .sort((x, y) => compareMonth(x.month, y.month));
    const catSpends = spends
      .filter((s) => s.categoryId === catId && compareMonth(s.month, upToMonth) <= 0)
      .sort((x, y) => compareMonth(x.month, y.month));

    const monthsSet = new Set<string>([
      ...catAssigns.map((a) => monthKey(a.month)),
      ...catSpends.map((s) => monthKey(s.month)),
    ]);
    const months = [...monthsSet].sort();

    const policy = policyBy.get(catId) ?? 'rollover_negative';
    let carry = 0;
    let absorbedThisMonth = 0;
    let balanceAtUpToMonth = 0;

    for (const mk of months) {
      const asgn = catAssigns
        .filter((a) => monthKey(a.month) === mk)
        .reduce((s, a) => s + toCents(a.amount), 0);
      const spend = catSpends
        .filter((s) => monthKey(s.month) === mk)
        .reduce((s, r) => s + toCents(r.amount), 0);
      const raw = carry + asgn - spend;

      if (mk === monthKey(upToMonth)) {
        balanceAtUpToMonth = raw;
        absorbedThisMonth = policy === 'reallocate_manual' && raw < 0 ? -raw : 0;
      }
      carry = policy === 'reallocate_manual' ? Math.max(0, raw) : raw;
      // When we've passed upToMonth (shouldn't happen given filter) stop.
    }

    // The balance is the raw balance at upToMonth (may be negative).
    // The carry is used internally for envelope logic but not reported.
    // If we processed no months for this cat, balanceAtUpToMonth stays 0.
    const balance = fromCents(balanceAtUpToMonth);
    out.set(catId, {
      balance,
      absorbedByPool: fromCents(absorbedThisMonth),
      overspent: policy === 'rollover_negative' ? balanceAtUpToMonth < 0 : absorbedThisMonth > 0,
    });
  }

  return out;
}

export function computePool(args: {
  upToMonth: string;
  incomeCumulative: Money;
  assignmentCumulative: Money;
  holdThisMonth: Money;
  holdPriorMonth: Money;
  totalAbsorbedPriorMonth: Money;
}): { available: Money; heldFromPriorMonths: Money; heldForNextMonth: Money } {
  const inc = toCents(args.incomeCumulative);
  const asg = toCents(args.assignmentCumulative);
  const hM = toCents(args.holdThisMonth);
  const hPrev = toCents(args.holdPriorMonth);
  const absorb = toCents(args.totalAbsorbedPriorMonth);
  const available = inc - asg - hM + hPrev - absorb;
  return {
    available: fromCents(available),
    heldFromPriorMonths: fromCents(hPrev),
    heldForNextMonth: fromCents(hM),
  };
}

export function reallocate(
  from: AssignmentRow | null,
  to: AssignmentRow | null,
  amount: Money,
): { from: AssignmentRow; to: AssignmentRow } {
  if (!from && !to) throw new Error('reallocate: both sides null');
  if (from && to && from.categoryId === to.categoryId && from.month === to.month) {
    throw new Error('reallocate: same envelope');
  }
  const a = toCents(amount);
  const fromRow: AssignmentRow = from ?? {
    categoryId: (to as AssignmentRow).categoryId, // placeholder; caller supplies real id
    month: (to as AssignmentRow).month,
    amount: '0.00',
  };
  const toRow: AssignmentRow = to ?? {
    categoryId: (from as AssignmentRow).categoryId,
    month: (from as AssignmentRow).month,
    amount: '0.00',
  };
  return {
    from: { ...fromRow, amount: fromCents(toCents(fromRow.amount) - a) },
    to:   { ...toRow,   amount: fromCents(toCents(toRow.amount)   + a) },
  };
}
