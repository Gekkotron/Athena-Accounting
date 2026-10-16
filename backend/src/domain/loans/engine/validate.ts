import { isIsoDate, isYearMonth } from './dates.js';
import { MAX_INSTALMENTS, type LoanError, type LoanTerms } from './types.js';

const DECIMAL = /^\d+(\.\d+)?$/;
const isDecimal = (s: unknown): s is string => typeof s === 'string' && DECIMAL.test(s);

// Shape-level checks the engine needs before it can run. The HTTP layer's
// zod schema catches most of these first; the engine re-checks so the demo
// build (no zod) and future callers get the same guarantees.
export function validateTerms(t: LoanTerms): LoanError[] {
  const errors: LoanError[] = [];
  const rate = (v: unknown, field: string) => {
    if (!isDecimal(v) || Number(v) > 100) errors.push({ code: 'invalid_rate', field });
  };
  const amount = (v: unknown, field: string, code: LoanError['code'] = 'invalid_amount') => {
    if (!isDecimal(v) || Number(v) <= 0) errors.push({ code, field });
  };

  if (!isDecimal(t.principal) || Number(t.principal) <= 0) {
    errors.push({ code: 'invalid_principal', field: 'principal' });
  }
  if (!isIsoDate(t.startDate)) errors.push({ code: 'invalid_date', field: 'startDate' });
  rate(t.annualRate, 'annualRate');
  rate(t.insuranceRate, 'insuranceRate');
  if (t.insuranceAmount != null && t.insuranceAmount !== '' && !isDecimal(t.insuranceAmount)) {
    errors.push({ code: 'invalid_amount', field: 'insuranceAmount' });
  }
  if (!isDecimal(t.fees)) errors.push({ code: 'invalid_amount', field: 'fees' });

  let months = 0;
  t.periods.forEach((p, i) => {
    if (!Number.isInteger(p.months) || p.months < 1) {
      errors.push({ code: 'invalid_months', field: `periods.${i}.months` });
    } else {
      months += p.months;
    }
    if (p.kind === 'payment') amount(p.amount, `periods.${i}.amount`, 'missing_amount');
    if (p.rate != null) rate(p.rate, `periods.${i}.rate`);
  });
  if (months > MAX_INSTALMENTS) errors.push({ code: 'too_long', field: 'periods' });

  const fp = t.finalPeriod;
  if (fp.solve === 'payment') {
    if (!isYearMonth(fp.endDate)) errors.push({ code: 'invalid_date', field: 'finalPeriod.endDate' });
  } else {
    amount(fp.amount, 'finalPeriod.amount', 'missing_amount');
  }
  if (fp.rate != null) rate(fp.rate, 'finalPeriod.rate');

  t.earlyRepayments.forEach((er, i) => {
    if (!isYearMonth(er.date)) errors.push({ code: 'invalid_date', field: `earlyRepayments.${i}.date` });
    amount(er.amount, `earlyRepayments.${i}.amount`);
    if (er.penalty != null && !isDecimal(er.penalty)) {
      errors.push({ code: 'invalid_amount', field: `earlyRepayments.${i}.penalty` });
    }
  });
  return errors;
}
