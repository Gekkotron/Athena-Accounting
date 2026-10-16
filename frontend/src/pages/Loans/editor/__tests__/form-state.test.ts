import { describe, it, expect } from 'vitest';
import {
  asSimulation, emptyForm, formFromLoan, formToInput, formToTerms, issuesToFieldErrors, parseRate,
  type LoanForm,
} from '../form-state';
import type { LoanInput } from '../../../../api/loans';

const french = (): LoanForm => ({
  ...emptyForm(false, '2026-02-05'),
  name: ' Maison ',
  principal: '245 000',
  annualRate: '3,85',
  insuranceRate: '0,345 %',
  fees: '1 850,50',
  periods: [{ kind: 'payment', months: '24', amount: '800,00', rate: '' }],
  solve: 'payment',
  endDate: '2048-08',
});

describe('parseRate', () => {
  it('accepts French decimals and a trailing %', () => {
    expect(parseRate('3,85')).toBe('3.85');
    expect(parseRate(' 0,345 % ')).toBe('0.345');
    expect(parseRate('101')).toBeNull();
    expect(parseRate('3,12345')).toBeNull();
    expect(parseRate('abc')).toBeNull();
  });
});

describe('formToTerms', () => {
  it('parses French-formatted input into wire terms', () => {
    expect(formToTerms(french())).toEqual({
      terms: {
        principal: '245000', startDate: '2026-02-05', annualRate: '3.85', insuranceRate: '0.345',
        insuranceBasis: 'initial', fees: '1850.50',
        periods: [{ kind: 'payment', months: 24, amount: '800.00' }],
        finalPeriod: { solve: 'payment', endDate: '2048-08' },
        earlyRepayments: [],
      },
    });
  });

  it('defaults blank insurance and fees to 0', () => {
    const res = formToTerms({ ...french(), insuranceRate: '', fees: '' });
    expect('terms' in res && res.terms.insuranceRate).toBe('0');
    expect('terms' in res && res.terms.fees).toBe('0');
  });

  it('collects every invalid field', () => {
    const res = formToTerms({
      ...french(),
      principal: 'abc',
      periods: [{ kind: 'payment', months: '1.5', amount: '', rate: '200' }],
      endDate: '',
    });
    expect(res).toEqual({
      fieldErrors: {
        principal: 'form.invalidDecimal',
        'periods.0.months': 'form.invalidMonths',
        'periods.0.amount': 'form.invalidDecimal',
        'periods.0.rate': 'form.invalidRate',
        'finalPeriod.endDate': 'form.invalidMonth',
      },
    });
  });
});

describe('formToInput / formFromLoan', () => {
  const loan: LoanInput = {
    name: 'Maison', kind: 'mortgage', isSimulation: false, sourceLoanId: null, currency: 'EUR',
    principal: '200000', startDate: '2026-02-05', annualRate: '3.5', insuranceRate: '0.3',
    insuranceBasis: 'remaining', fees: '0',
    periods: [{ kind: 'partial_deferral', months: 12 }, { kind: 'payment', months: 6, amount: '900', rate: '1' }],
    finalPeriod: { solve: 'end_date', amount: '1400', rate: '2.5' },
    earlyRepayments: [{ date: '2030-01', amount: '20000', effect: 'shorten', penalty: '600' }],
  };

  it('round-trips a loan through the form', () => {
    expect(formToInput(formFromLoan(loan))).toEqual({ input: loan });
  });

  it('requires a name', () => {
    expect(formToInput({ ...formFromLoan(loan), name: '  ' })).toEqual({ fieldErrors: { name: 'form.nameRequired' } });
  });

  it('points a simulation at the real loan, even when duplicating a simulation', () => {
    const f = formFromLoan(loan);
    expect(asSimulation(f, { id: 4, isSimulation: false, sourceLoanId: null }, 'Copie')).toMatchObject({
      name: 'Copie', isSimulation: true, sourceLoanId: 4,
    });
    expect(asSimulation(f, { id: 9, isSimulation: true, sourceLoanId: 4 }, 'Copie').sourceLoanId).toBe(4);
  });
});

describe('issuesToFieldErrors', () => {
  it('maps engine issues to i18n keys by field', () => {
    expect(issuesToFieldErrors([
      { code: 'payment_too_low', field: 'finalPeriod.amount' },
      { code: 'too_long' },
    ])).toEqual({ 'finalPeriod.amount': 'issues.payment_too_low', '': 'issues.too_long' });
  });
});
