import type {
  LoanEarlyRepayment,
  LoanFinalPeriod,
  LoanFixedPeriod,
  LoanFixedPeriodKind,
  LoanInput,
  LoanInsuranceBasis,
  LoanIssue,
  LoanKind,
  LoanRepaymentEffect,
  LoanTermsInput,
} from '../../../api/loans';
import { parseDecimal } from '../../../lib/format';

// Editor state: every input kept as the user typed it (French decimals,
// spaces), parsed only when building the request.
export interface PeriodForm {
  kind: LoanFixedPeriodKind;
  months: string;
  amount: string;
  rate: string; // '' = use the loan rate
}

export interface EarlyForm {
  date: string; // YYYY-MM
  amount: string;
  effect: LoanRepaymentEffect;
  penalty: string;
}

export interface LoanForm {
  name: string;
  kind: LoanKind;
  isSimulation: boolean;
  sourceLoanId: number | null;
  currency: string;
  principal: string;
  startDate: string; // YYYY-MM-DD
  annualRate: string;
  insuranceRate: string;
  insuranceBasis: LoanInsuranceBasis;
  // '' means "use the rate × basis computation above"; a decimal entry
  // bills exactly that flat premium every month and ignores rate+basis.
  insuranceAmount: string;
  fees: string;
  periods: PeriodForm[];
  solve: 'payment' | 'end_date';
  endDate: string; // YYYY-MM, used when solve === 'payment'
  finalAmount: string; // used when solve === 'end_date'
  finalRate: string;
  earlyRepayments: EarlyForm[];
}

// Dotted engine field path ("periods.0.amount") → i18n key in `loans`.
export type FieldErrors = Record<string, string>;

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Like parseDecimal, but rates allow 4 fraction digits (insurance 0,345 %)
// and a trailing %; capped at 100.
export function parseRate(raw: string): string | null {
  const cleaned = raw.replace(/%/g, '').replace(/\s+/g, '').replace(',', '.').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(cleaned) || Number(cleaned) > 100) return null;
  return cleaned;
}

export function emptyForm(isSimulation: boolean, today: string): LoanForm {
  return {
    name: '', kind: 'mortgage', isSimulation, sourceLoanId: null, currency: 'EUR',
    principal: '', startDate: today, annualRate: '', insuranceRate: '0', insuranceBasis: 'initial',
    insuranceAmount: '', fees: '0',
    periods: [], solve: 'payment', endDate: '', finalAmount: '', finalRate: '', earlyRepayments: [],
  };
}

export function formFromLoan(l: LoanInput): LoanForm {
  const fp = l.finalPeriod;
  return {
    name: l.name, kind: l.kind, isSimulation: l.isSimulation, sourceLoanId: l.sourceLoanId, currency: l.currency,
    principal: l.principal, startDate: l.startDate, annualRate: l.annualRate, insuranceRate: l.insuranceRate,
    insuranceBasis: l.insuranceBasis, insuranceAmount: l.insuranceAmount ?? '',
    fees: l.fees,
    periods: l.periods.map((p) => ({ kind: p.kind, months: String(p.months), amount: p.amount ?? '', rate: p.rate ?? '' })),
    solve: fp.solve,
    endDate: fp.solve === 'payment' ? fp.endDate : '',
    finalAmount: fp.solve === 'end_date' ? fp.amount : '',
    finalRate: fp.rate ?? '',
    earlyRepayments: l.earlyRepayments.map((e) => ({ date: e.date, amount: e.amount, effect: e.effect, penalty: e.penalty ?? '' })),
  };
}

// A simulation always points at a REAL loan: duplicating a simulation keeps
// its source rather than chaining scenario → scenario.
export function asSimulation(
  f: LoanForm,
  source: { id: number; isSimulation: boolean; sourceLoanId: number | null },
  name: string,
): LoanForm {
  return { ...f, name, isSimulation: true, sourceLoanId: source.isSimulation ? source.sourceLoanId : source.id };
}

export function formToTerms(f: LoanForm): { terms: LoanTermsInput } | { fieldErrors: FieldErrors } {
  const errors: FieldErrors = {};
  const money = (raw: string, field: string): string => {
    const v = parseDecimal(raw);
    if (v === null || v.startsWith('-')) {
      errors[field] = 'form.invalidDecimal';
      return '0';
    }
    return v;
  };
  const rate = (raw: string, field: string): string => {
    const v = parseRate(raw);
    if (v === null) {
      errors[field] = 'form.invalidRate';
      return '0';
    }
    return v;
  };
  const optional = <T,>(raw: string, parse: (raw: string) => T): T | undefined =>
    raw.trim() === '' ? undefined : parse(raw);
  const month = (raw: string, field: string): string => {
    if (!YEAR_MONTH.test(raw)) errors[field] = 'form.invalidMonth';
    return raw;
  };

  if (!ISO_DATE.test(f.startDate)) errors.startDate = 'form.invalidDate';
  const principal = money(f.principal, 'principal');
  const annualRate = rate(f.annualRate, 'annualRate');
  const insuranceRate = optional(f.insuranceRate, (r) => rate(r, 'insuranceRate')) ?? '0';
  const insuranceAmount = optional(f.insuranceAmount, (r) => money(r, 'insuranceAmount'));
  const fees = optional(f.fees, (r) => money(r, 'fees')) ?? '0';

  const periods = f.periods.map((p, i): LoanFixedPeriod => {
    const months = Number(p.months);
    if (!Number.isInteger(months) || months < 1) errors[`periods.${i}.months`] = 'form.invalidMonths';
    const out: LoanFixedPeriod = { kind: p.kind, months };
    if (p.kind === 'payment') out.amount = money(p.amount, `periods.${i}.amount`);
    const r = optional(p.rate, (raw) => rate(raw, `periods.${i}.rate`));
    if (r !== undefined) out.rate = r;
    return out;
  });

  const finalRate = optional(f.finalRate, (raw) => rate(raw, 'finalPeriod.rate'));
  const withRate = finalRate === undefined ? {} : { rate: finalRate };
  const finalPeriod: LoanFinalPeriod = f.solve === 'payment'
    ? { solve: 'payment', endDate: month(f.endDate, 'finalPeriod.endDate'), ...withRate }
    : { solve: 'end_date', amount: money(f.finalAmount, 'finalPeriod.amount'), ...withRate };

  const earlyRepayments = f.earlyRepayments.map((e, i): LoanEarlyRepayment => {
    const out: LoanEarlyRepayment = {
      date: month(e.date, `earlyRepayments.${i}.date`),
      amount: money(e.amount, `earlyRepayments.${i}.amount`),
      effect: e.effect,
    };
    const penalty = optional(e.penalty, (raw) => money(raw, `earlyRepayments.${i}.penalty`));
    if (penalty !== undefined) out.penalty = penalty;
    return out;
  });

  if (Object.keys(errors).length > 0) return { fieldErrors: errors };
  return {
    terms: {
      principal, startDate: f.startDate, annualRate, insuranceRate, insuranceBasis: f.insuranceBasis,
      ...(insuranceAmount !== undefined ? { insuranceAmount } : {}),
      fees, periods, finalPeriod, earlyRepayments,
    },
  };
}

export function formToInput(f: LoanForm): { input: LoanInput } | { fieldErrors: FieldErrors } {
  const res = formToTerms(f);
  const nameError: FieldErrors = f.name.trim() === '' ? { name: 'form.nameRequired' } : {};
  if ('fieldErrors' in res) return { fieldErrors: { ...res.fieldErrors, ...nameError } };
  if (nameError.name) return { fieldErrors: nameError };
  return {
    input: {
      ...res.terms,
      name: f.name.trim(), kind: f.kind, isSimulation: f.isSimulation,
      sourceLoanId: f.sourceLoanId, currency: f.currency,
    },
  };
}

// Engine issues (422 errors, warnings) keyed by field; issues without a
// field land under '' and are shown by PreviewSummary.
export function issuesToFieldErrors(issues: LoanIssue[]): FieldErrors {
  const out: FieldErrors = {};
  for (const i of issues) out[i.field ?? ''] = `issues.${i.code}`;
  return out;
}
