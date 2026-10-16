import { describe, it, expect } from 'vitest';
import { LoanBody, LoanTermsBody } from '../src/http/routes/loans/schemas.js';

const terms = {
  principal: '200000.00',
  startDate: '2026-02-05',
  annualRate: '3.5',
  finalPeriod: { solve: 'payment', endDate: '2046-01' },
};

describe('loan zod schemas', () => {
  it('fills defaults', () => {
    const r = LoanTermsBody.parse(terms);
    expect(r).toMatchObject({
      insuranceRate: '0', insuranceBasis: 'initial', fees: '0', periods: [], earlyRepayments: [],
    });
    const b = LoanBody.parse({ ...terms, name: '  Maison ' });
    expect(b).toMatchObject({ name: 'Maison', kind: 'other', isSimulation: false, sourceLoanId: null, currency: 'EUR' });
  });

  it('accepts 4-digit rates and rejects rates over 100', () => {
    expect(LoanTermsBody.safeParse({ ...terms, insuranceRate: '0.3450' }).success).toBe(true);
    expect(LoanTermsBody.safeParse({ ...terms, annualRate: '100.5' }).success).toBe(false);
  });

  it('requires an amount on payment periods only', () => {
    const bad = { ...terms, periods: [{ kind: 'payment', months: 12 }] };
    const ok = { ...terms, periods: [{ kind: 'partial_deferral', months: 12 }] };
    expect(LoanTermsBody.safeParse(bad).success).toBe(false);
    expect(LoanTermsBody.safeParse(ok).success).toBe(true);
  });

  it('discriminates the final period on `solve`', () => {
    expect(LoanTermsBody.safeParse({ ...terms, finalPeriod: { solve: 'end_date', amount: '1400' } }).success).toBe(true);
    expect(LoanTermsBody.safeParse({ ...terms, finalPeriod: { solve: 'end_date', endDate: '2046-01' } }).success).toBe(false);
    expect(LoanTermsBody.safeParse({ ...terms, finalPeriod: { solve: 'payment', endDate: '2046-13' } }).success).toBe(false);
  });

  it('rejects unknown keys inside periods (strict)', () => {
    const r = LoanTermsBody.safeParse({ ...terms, periods: [{ kind: 'partial_deferral', months: 1, extra: 1 }] });
    expect(r.success).toBe(false);
  });

  it('validates early repayments', () => {
    const er = { date: '2030-01', amount: '20000', effect: 'shorten', penalty: '600' };
    expect(LoanTermsBody.safeParse({ ...terms, earlyRepayments: [er] }).success).toBe(true);
    expect(LoanTermsBody.safeParse({ ...terms, earlyRepayments: [{ ...er, effect: 'both' }] }).success).toBe(false);
  });
});
