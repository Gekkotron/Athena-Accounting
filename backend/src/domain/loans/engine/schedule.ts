import { instalmentDate, monthIndex } from './dates.js';
import { annuity, fromCents, monthlyRate, monthsToRepay, roundHalfAway, toCents } from './money.js';
import {
  MAX_INSTALMENTS,
  type LoanError,
  type LoanTerms,
  type LoanWarning,
  type RepaymentEffect,
  type RowKind,
  type ScheduleRow,
} from './types.js';

// Mutable walk state. Amounts in cents.
interface Cursor {
  rows: ScheduleRow[];
  balance: number; // capital owed after the last pushed row
  penalties: number;
  lastEffect: RepaymentEffect | null; // effect of the latest applied early repayment
  applied: Set<number>; // indexes into terms.earlyRepayments
  warnings: LoanWarning[];
}

interface Month {
  periodIndex: number;
  kind: RowKind;
  ratePct: string;
  payment: number;
  interest: number;
  capital: number;
}

export interface RowsResult {
  rows: ScheduleRow[];
  warnings: LoanWarning[];
  penalties: number;
  solvedPayment: number | null; // first instalment of the final period
}

function warn(c: Cursor, code: LoanWarning['code'], field: string): void {
  if (!c.warnings.some((w) => w.code === code && w.field === field)) c.warnings.push({ code, field });
}

function insuranceCents(t: LoanTerms, balance: number): number {
  const r = monthlyRate(t.insuranceRate);
  return roundHalfAway((t.insuranceBasis === 'initial' ? toCents(t.principal) : balance) * r);
}

// Pushes one instalment, then applies that month's early repayments.
// Returns the early-repayment cents applied this month.
function pushRow(t: LoanTerms, c: Cursor, m: Month, withEarly: boolean): number {
  const index = c.rows.length;
  const date = instalmentDate(t.startDate, index);
  const insurance = insuranceCents(t, c.balance);
  c.balance -= m.capital;
  let early = 0;
  if (withEarly) {
    const month = monthIndex(date);
    t.earlyRepayments.forEach((er, i) => {
      if (c.applied.has(i) || monthIndex(er.date) !== month || c.balance <= 0) return;
      const amt = Math.min(toCents(er.amount), c.balance);
      c.balance -= amt;
      early += amt;
      c.penalties += er.penalty ? toCents(er.penalty) : 0;
      c.lastEffect = er.effect;
      c.applied.add(i);
    });
  }
  c.rows.push({
    index: index + 1,
    date,
    periodIndex: m.periodIndex,
    kind: m.kind,
    rate: m.ratePct,
    payment: fromCents(m.payment),
    interest: fromCents(m.interest),
    capital: fromCents(m.capital),
    insurance: fromCents(insurance),
    earlyRepayment: early > 0 ? fromCents(early) : null,
    balance: fromCents(c.balance),
  });
  return early;
}

function runFixed(t: LoanTerms, withEarly: boolean): Cursor {
  const c: Cursor = {
    rows: [], balance: toCents(t.principal), penalties: 0,
    lastEffect: null, applied: new Set(), warnings: [],
  };
  t.periods.forEach((p, pi) => {
    const ratePct = p.rate ?? t.annualRate;
    const r = monthlyRate(ratePct);
    for (let m = 0; m < p.months && c.balance > 0; m++) {
      const interest = roundHalfAway(c.balance * r);
      let payment = 0;
      let capital = -interest; // total_deferral: interest is capitalised
      if (p.kind === 'partial_deferral') {
        payment = interest;
        capital = 0;
      } else if (p.kind === 'payment') {
        payment = toCents(p.amount ?? '0');
        capital = payment - interest;
        if (capital < 0) warn(c, 'negative_amortization', `periods.${pi}.amount`);
        if (capital >= c.balance) {
          capital = c.balance;
          payment = c.balance + interest;
          warn(c, 'repaid_during_fixed_period', `periods.${pi}`);
        }
      }
      pushRow(t, c, { periodIndex: pi, kind: p.kind, ratePct, payment, interest, capital }, withEarly);
    }
  });
  return c;
}

// Walks the final period. `endIdx` is the 0-based index of the last
// instalment when the end date is pinned, null when it floats.
function runFinal(t: LoanTerms, c: Cursor): LoanError | number {
  const fp = t.finalPeriod;
  const ratePct = fp.rate ?? t.annualRate;
  const r = monthlyRate(ratePct);
  const k0 = c.rows.length;
  // Early repayments inside fixed periods: the latest one's effect decides
  // what the final period keeps (spec: "most recent one decides").
  const fixedEffect = c.lastEffect;
  let payment: number;
  let endIdx: number | null = null;

  if (fp.solve === 'payment') {
    const n = monthIndex(fp.endDate) - monthIndex(instalmentDate(t.startDate, k0)) + 1;
    if (fixedEffect === 'shorten') {
      payment = annuity(runFixed(t, false).balance, r, n);
    } else {
      payment = annuity(c.balance, r, n);
      endIdx = k0 + n - 1;
    }
  } else {
    payment = toCents(fp.amount);
    if (fixedEffect === 'reduce_payment') {
      const nRef = monthsToRepay(runFixed(t, false).balance, r, payment, MAX_INSTALMENTS);
      if (nRef === null) return { code: 'payment_too_low', field: 'finalPeriod.amount' };
      endIdx = k0 + nRef - 1;
      payment = annuity(c.balance, r, nRef);
    }
  }
  if (payment <= roundHalfAway(c.balance * r)) {
    return { code: 'payment_too_low', field: fp.solve === 'end_date' ? 'finalPeriod.amount' : 'finalPeriod.endDate' };
  }
  const solved = payment;

  while (c.balance > 0) {
    const index = c.rows.length;
    if (index >= MAX_INSTALMENTS) return { code: 'too_long', field: 'finalPeriod' };
    const interest = roundHalfAway(c.balance * r);
    let pay = payment;
    let capital = pay - interest;
    if ((endIdx !== null && index >= endIdx) || capital >= c.balance) {
      capital = c.balance;
      pay = c.balance + interest;
    }
    const early = pushRow(t, c, { periodIndex: -1, kind: 'final', ratePct, payment: pay, interest, capital }, true);
    if (early === 0 || c.balance <= 0) continue;
    if (c.lastEffect === 'shorten') {
      endIdx = null;
    } else {
      if (endIdx === null) {
        const left = monthsToRepay(c.balance + early, r, payment, MAX_INSTALMENTS);
        endIdx = index + (left ?? 1);
      }
      payment = annuity(c.balance, r, Math.max(endIdx - index, 1));
    }
  }
  return solved;
}

export function buildRows(t: LoanTerms): RowsResult | { errors: LoanError[] } {
  const fixedMonths = t.periods.reduce((s, p) => s + p.months, 0);
  const fp = t.finalPeriod;
  if (fp.solve === 'payment'
    && monthIndex(fp.endDate) < monthIndex(instalmentDate(t.startDate, fixedMonths))) {
    return { errors: [{ code: 'end_before_fixed_periods', field: 'finalPeriod.endDate' }] };
  }

  const c = runFixed(t, true);
  let solvedPayment: number | null = null;
  if (c.balance > 0) {
    const res = runFinal(t, c);
    if (typeof res !== 'number') return { errors: [res] };
    solvedPayment = res;
  }

  const errors: LoanError[] = [];
  t.earlyRepayments.forEach((er, i) => {
    if (c.applied.has(i)) return;
    const before = monthIndex(er.date) < monthIndex(t.startDate);
    errors.push({
      code: before ? 'early_repayment_before_start' : 'early_repayment_after_end',
      field: `earlyRepayments.${i}.date`,
    });
  });
  if (errors.length > 0) return { errors };

  return { rows: c.rows, warnings: c.warnings, penalties: c.penalties, solvedPayment };
}
