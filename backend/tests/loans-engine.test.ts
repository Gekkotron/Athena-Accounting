import { describe, it, expect } from 'vitest';
import { buildSchedule, type LoanTerms, type LoanResult, type ScheduleRow } from '../src/domain/loans/engine/index.js';
import { annuity, fromCents, toCents } from '../src/domain/loans/engine/money.js';
import { instalmentDate } from '../src/domain/loans/engine/dates.js';

const ASOF = '2026-10-16';

function terms(over: Partial<LoanTerms> = {}): LoanTerms {
  return {
    principal: '200000.00',
    startDate: '2026-02-05',
    annualRate: '3.5',
    insuranceRate: '0',
    insuranceBasis: 'initial',
    fees: '0',
    periods: [],
    finalPeriod: { solve: 'payment', endDate: '2046-01' }, // 240 instalments
    earlyRepayments: [],
    ...over,
  };
}

function ok(res: LoanResult) {
  if (!res.ok) throw new Error(`expected ok, got ${JSON.stringify(res.errors)}`);
  return res;
}

const cents = (rows: ScheduleRow[], k: keyof ScheduleRow) =>
  rows.reduce((s, r) => s + toCents((r[k] as string | null) ?? '0'), 0);

// Invariants every valid schedule must satisfy.
function checkInvariants(t: LoanTerms, res: ReturnType<typeof ok>) {
  const rows = res.schedule;
  expect(rows[rows.length - 1]!.balance).toBe('0.00');
  // Σ capital + Σ early repayments = principal (capitalised interest is a
  // negative capital row, so it is already netted in Σ capital).
  expect(cents(rows, 'capital') + cents(rows, 'earlyRepayment')).toBe(toCents(t.principal));
  const s = res.summary.totals;
  expect(toCents(s.cost)).toBe(
    toCents(s.interest) + toCents(s.insurance) + toCents(s.fees) + toCents(s.penalties),
  );
  expect(toCents(s.totalPaid)).toBe(toCents(t.principal) + toCents(s.cost));
  rows.forEach((r, i) => expect(r.index).toBe(i + 1));
}

describe('money + dates helpers', () => {
  it('round-trips cents', () => {
    expect(toCents('0.29')).toBe(29);
    expect(fromCents(123456)).toBe('1234.56');
    expect(fromCents(-5)).toBe('-0.05');
  });
  it('clamps the 31st to the month end', () => {
    expect(instalmentDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(instalmentDate('2028-01-31', 1)).toBe('2028-02-29');
    expect(instalmentDate('2026-01-31', 2)).toBe('2026-03-31');
    expect(instalmentDate('2026-11-15', 2)).toBe('2027-01-15');
  });
});

describe('constant loan', () => {
  it('200 000 € at 3.5 % over 240 months → 1 159.92 €/month', () => {
    const t = terms();
    const res = ok(buildSchedule(t, ASOF));
    expect(res.schedule).toHaveLength(240);
    expect(res.summary.solvedPayment).toBe('1159.92');
    expect(res.summary.endDate).toBe('2046-01-05');
    checkInvariants(t, res);
  });

  it('0 % consumer loan splits the capital evenly', () => {
    const t = terms({ principal: '1200', annualRate: '0', finalPeriod: { solve: 'payment', endDate: '2027-01' } });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.schedule).toHaveLength(12);
    expect(res.schedule.every((r) => r.payment === '100.00' && r.interest === '0.00')).toBe(true);
    expect(res.summary.totals.cost).toBe('0.00');
    checkInvariants(t, res);
  });

  it('a one-month loan pays everything at once', () => {
    const t = terms({ principal: '1000', annualRate: '12', finalPeriod: { solve: 'payment', endDate: '2026-02' } });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.schedule).toHaveLength(1);
    expect(res.schedule[0]!.payment).toBe('1010.00');
    checkInvariants(t, res);
  });
});

describe('reduced first period (palier)', () => {
  it('24 × 800 € then the solved payment matches the closed form', () => {
    const t = terms({ periods: [{ kind: 'payment', months: 24, amount: '800' }] });
    const res = ok(buildSchedule(t, ASOF));
    const r = 0.035 / 12;
    const g = Math.pow(1 + r, 24);
    const b24 = 200000 * g - (800 * (g - 1)) / r;
    const expected = (b24 * r) / (1 - Math.pow(1 + r, -216));
    expect(Math.abs(Number(res.summary.solvedPayment) - expected)).toBeLessThan(0.05);
    expect(Number(res.summary.solvedPayment)).toBeGreaterThan(1215);
    expect(res.schedule).toHaveLength(240);
    checkInvariants(t, res);
  });
});

describe('solve modes round-trip', () => {
  it('feeding the solved payment back gives the same end date', () => {
    const solved = ok(buildSchedule(terms(), ASOF));
    const back = ok(buildSchedule(
      terms({ finalPeriod: { solve: 'end_date', amount: solved.summary.solvedPayment! } }),
      ASOF,
    ));
    expect(back.summary.endDate).toBe(solved.summary.endDate);
    checkInvariants(terms(), back);
  });

  it('a higher amount moves the end date earlier', () => {
    const t = terms({ finalPeriod: { solve: 'end_date', amount: '1400' } });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.summary.endDate < '2046-01-05').toBe(true);
    expect(res.summary.solvedPayment).toBe('1400.00');
    checkInvariants(t, res);
  });
});

describe('insurance', () => {
  it('initial basis is constant', () => {
    const t = terms({ insuranceRate: '0.30', insuranceBasis: 'initial' });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.schedule.every((r) => r.insurance === '50.00')).toBe(true);
    expect(res.summary.totals.insurance).toBe('12000.00');
    expect(res.summary.currentPaymentWithInsurance).toBe('1209.92');
    checkInvariants(t, res);
  });

  it('remaining basis decreases with the capital owed', () => {
    const t = terms({ insuranceRate: '0.30', insuranceBasis: 'remaining' });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.schedule[0]!.insurance).toBe('50.00');
    expect(Number(res.schedule[239]!.insurance)).toBeLessThan(1);
    expect(Number(res.summary.totals.insurance)).toBeLessThan(12000);
    checkInvariants(t, res);
  });

  it('fixed monthly amount overrides rate and basis', () => {
    // Matches a bank schedule that quotes a flat 42,71 € premium — the
    // user's input to compare against their lender's amortisation table.
    const t = terms({
      insuranceRate: '0.30',       // ignored
      insuranceBasis: 'remaining', // ignored
      insuranceAmount: '42.71',
    });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.schedule.every((r) => r.insurance === '42.71')).toBe(true);
    expect(res.summary.totals.insurance).toBe('10250.40'); // 42.71 * 240
    checkInvariants(t, res);
  });

  it('empty insuranceAmount string falls back to rate × basis', () => {
    const t = terms({ insuranceRate: '0.30', insuranceAmount: '' });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.schedule.every((r) => r.insurance === '50.00')).toBe(true);
    checkInvariants(t, res);
  });
});

describe('deferrals', () => {
  it('partial deferral pays interest only, capital unchanged', () => {
    const t = terms({ periods: [{ kind: 'partial_deferral', months: 12 }] });
    const res = ok(buildSchedule(t, ASOF));
    const first = res.schedule.slice(0, 12);
    expect(first.every((r) => r.capital === '0.00' && r.balance === '200000.00')).toBe(true);
    expect(first[0]!.payment).toBe('583.33');
    expect(res.schedule).toHaveLength(240);
    checkInvariants(t, res);
  });

  it('total deferral capitalises interest, insurance still due', () => {
    const t = terms({
      insuranceRate: '0.30',
      periods: [{ kind: 'total_deferral', months: 6 }],
    });
    const res = ok(buildSchedule(t, ASOF));
    const first = res.schedule.slice(0, 6);
    expect(first.every((r) => r.payment === '0.00' && r.insurance === '50.00')).toBe(true);
    expect(Number(first[5]!.balance)).toBeGreaterThan(203000);
    checkInvariants(t, res);
  });
});

describe('rate per period', () => {
  it('uses the override for its period and the loan rate after', () => {
    const t = terms({ periods: [{ kind: 'payment', months: 12, amount: '1000', rate: '1' }] });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.schedule[0]!.interest).toBe('166.67');
    expect(res.schedule[0]!.rate).toBe('1');
    expect(res.schedule[12]!.rate).toBe('3.5');
    checkInvariants(t, res);
  });
});

describe('early repayment', () => {
  const base = ok(buildSchedule(terms(), ASOF));

  it('reduce_payment keeps the end date and lowers the payment', () => {
    const t = terms({ earlyRepayments: [{ date: '2030-01', amount: '20000', effect: 'reduce_payment' }] });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.summary.endDate).toBe(base.summary.endDate);
    const after = res.schedule.find((r) => r.date > '2030-01-31')!;
    expect(Number(after.payment)).toBeLessThan(1159.92);
    expect(Number(res.summary.totals.interest)).toBeLessThan(Number(base.summary.totals.interest));
    checkInvariants(t, res);
  });

  it('shorten keeps the payment and ends earlier', () => {
    const t = terms({ earlyRepayments: [{ date: '2030-01', amount: '20000', effect: 'shorten', penalty: '600' }] });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.summary.endDate < base.summary.endDate).toBe(true);
    const after = res.schedule.find((r) => r.date > '2030-01-31')!;
    expect(after.payment).toBe('1159.92');
    expect(res.summary.totals.penalties).toBe('600.00');
    checkInvariants(t, res);
  });

  it('a full payoff ends the loan on that month', () => {
    const t = terms({ earlyRepayments: [{ date: '2027-01', amount: '999999', effect: 'shorten' }] });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.summary.endDate).toBe('2027-01-05');
    checkInvariants(t, res);
  });

  it('inside a fixed period with reduce_payment, the end date holds', () => {
    const t = terms({
      periods: [{ kind: 'payment', months: 24, amount: '800' }],
      finalPeriod: { solve: 'end_date', amount: '1300' },
      earlyRepayments: [{ date: '2027-01', amount: '10000', effect: 'reduce_payment' }],
    });
    const ref = ok(buildSchedule({ ...t, earlyRepayments: [] }, ASOF));
    const res = ok(buildSchedule(t, ASOF));
    expect(res.summary.endDate).toBe(ref.summary.endDate);
    expect(Number(res.summary.solvedPayment)).toBeLessThan(1300);
    checkInvariants(t, res);
  });

  it('inside a fixed period with shorten, the payment holds', () => {
    const t = terms({
      periods: [{ kind: 'payment', months: 24, amount: '800' }],
      earlyRepayments: [{ date: '2027-01', amount: '10000', effect: 'shorten' }],
    });
    const ref = ok(buildSchedule({ ...t, earlyRepayments: [] }, ASOF));
    const res = ok(buildSchedule(t, ASOF));
    expect(res.summary.solvedPayment).toBe(ref.summary.solvedPayment);
    expect(res.summary.endDate < ref.summary.endDate).toBe(true);
    checkInvariants(t, res);
  });
});

describe('today status', () => {
  it('before the first instalment', () => {
    const res = ok(buildSchedule(terms(), '2026-01-01'));
    expect(res.summary.today).toMatchObject({
      status: 'not_started', capitalOwed: '200000.00', repaidPct: 0, monthsLeft: 240,
    });
    expect(res.summary.today.nextInstalment).toEqual({ date: '2026-02-05', amount: '1159.92' });
  });

  it('mid-loan counts instalments dated on or before asOf', () => {
    const res = ok(buildSchedule(terms(), '2026-04-05'));
    expect(res.summary.today.status).toBe('active');
    expect(res.summary.today.monthsLeft).toBe(237);
    expect(res.summary.today.capitalOwed).toBe(res.schedule[2]!.balance);
    expect(res.summary.today.nextInstalment!.date).toBe('2026-05-05');
  });

  it('after the end', () => {
    const res = ok(buildSchedule(terms(), '2050-01-01'));
    expect(res.summary.today).toMatchObject({ status: 'repaid', capitalOwed: '0.00', repaidPct: 100, monthsLeft: 0 });
    expect(res.summary.today.nextInstalment).toBeNull();
    expect(res.summary.currentPayment).toBe('0.00');
  });
});

describe('errors', () => {
  const codes = (t: LoanTerms) => {
    const res = buildSchedule(t, ASOF);
    return res.ok ? [] : res.errors.map((e) => `${e.code}@${e.field}`);
  };

  it('rejects bad shapes', () => {
    expect(codes(terms({ principal: '0' }))).toContain('invalid_principal@principal');
    expect(codes(terms({ annualRate: '101' }))).toContain('invalid_rate@annualRate');
    expect(codes(terms({ periods: [{ kind: 'payment', months: 0, amount: '1' }] })))
      .toContain('invalid_months@periods.0.months');
    expect(codes(terms({ periods: [{ kind: 'payment', months: 3 }] })))
      .toContain('missing_amount@periods.0.amount');
  });

  it('end date before the end of the fixed periods', () => {
    expect(codes(terms({
      periods: [{ kind: 'partial_deferral', months: 24 }],
      finalPeriod: { solve: 'payment', endDate: '2027-01' },
    }))).toEqual(['end_before_fixed_periods@finalPeriod.endDate']);
  });

  it('a payment that never covers the interest', () => {
    expect(codes(terms({ finalPeriod: { solve: 'end_date', amount: '500' } })))
      .toEqual(['payment_too_low@finalPeriod.amount']);
  });

  it('more than 600 instalments', () => {
    expect(codes(terms({ finalPeriod: { solve: 'end_date', amount: '584' } })))
      .toEqual(['too_long@finalPeriod']);
  });

  it('early repayment outside the loan', () => {
    expect(codes(terms({ earlyRepayments: [{ date: '2025-01', amount: '10', effect: 'shorten' }] })))
      .toEqual(['early_repayment_before_start@earlyRepayments.0.date']);
    expect(codes(terms({ earlyRepayments: [{ date: '2047-01', amount: '10', effect: 'shorten' }] })))
      .toEqual(['early_repayment_after_end@earlyRepayments.0.date']);
  });
});

describe('warnings', () => {
  it('repaid during a fixed period', () => {
    const t = terms({ principal: '1000', periods: [{ kind: 'payment', months: 12, amount: '500' }] });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.warnings).toEqual([{ code: 'repaid_during_fixed_period', field: 'periods.0' }]);
    expect(res.schedule).toHaveLength(3);
    expect(res.summary.solvedPayment).toBeNull();
    checkInvariants(t, res);
  });

  it('negative amortisation', () => {
    const t = terms({ periods: [{ kind: 'payment', months: 6, amount: '100' }] });
    const res = ok(buildSchedule(t, ASOF));
    expect(res.warnings).toContainEqual({ code: 'negative_amortization', field: 'periods.0.amount' });
    checkInvariants(t, res);
  });
});

describe('annuity helper', () => {
  it('rounds up so the loan finishes in n months', () => {
    expect(annuity(120000, 0, 12)).toBe(10000);
    expect(annuity(100, 0, 3)).toBe(34);
  });
});
