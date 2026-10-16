// Loan engine contracts. Pure data — no Node, DB or framework types — so the
// frontend demo build can import this module directly. Mirrored (by hand)
// in shared/api-contracts.ts for the frontend's API types.

export const MAX_INSTALMENTS = 600;

export type InsuranceBasis = 'initial' | 'remaining';
export type FixedPeriodKind = 'payment' | 'partial_deferral' | 'total_deferral';
export type RepaymentEffect = 'reduce_payment' | 'shorten';

export interface FixedPeriod {
  kind: FixedPeriodKind;
  months: number;
  amount?: string; // required iff kind === 'payment'; excludes insurance
  rate?: string | null; // annual % override for this period
}

export type FinalPeriod =
  | { solve: 'payment'; endDate: string; rate?: string | null } // endDate: YYYY-MM
  | { solve: 'end_date'; amount: string; rate?: string | null };

export interface EarlyRepayment {
  date: string; // YYYY-MM — applied right after that month's instalment
  amount: string;
  effect: RepaymentEffect;
  penalty?: string;
}

export interface LoanTerms {
  principal: string;
  startDate: string; // YYYY-MM-DD, first instalment
  annualRate: string; // nominal annual %, "3.5" = 3.5 %
  insuranceRate: string; // annual %
  insuranceBasis: InsuranceBasis;
  // Optional fixed monthly insurance (euros). When non-empty, every row
  // bills this exact amount and insuranceRate/insuranceBasis are ignored.
  // Lets users mirror a bank schedule that quotes a flat monthly premium
  // (common on consumer and mortgage loans) instead of a rate.
  insuranceAmount?: string | null;
  fees: string;
  periods: FixedPeriod[];
  finalPeriod: FinalPeriod;
  earlyRepayments: EarlyRepayment[];
}

export type RowKind = FixedPeriodKind | 'final';

export interface ScheduleRow {
  index: number; // 1-based
  date: string; // YYYY-MM-DD
  periodIndex: number; // index into periods, -1 = final period
  kind: RowKind;
  rate: string;
  payment: string; // instalment excl. insurance
  interest: string;
  capital: string; // negative during a total deferral
  insurance: string;
  earlyRepayment: string | null;
  balance: string; // capital owed after this month
}

export type LoanErrorCode =
  | 'invalid_principal'
  | 'invalid_rate'
  | 'invalid_amount'
  | 'invalid_months'
  | 'invalid_date'
  | 'missing_amount'
  | 'end_before_fixed_periods'
  | 'payment_too_low'
  | 'too_long'
  | 'early_repayment_before_start'
  | 'early_repayment_after_end';

export interface LoanError {
  code: LoanErrorCode;
  field?: string; // dotted path into LoanTerms, e.g. "periods.1.amount"
}

export type LoanWarningCode = 'repaid_during_fixed_period' | 'negative_amortization';

export interface LoanWarning {
  code: LoanWarningCode;
  field?: string;
}

export type LoanStatus = 'not_started' | 'active' | 'repaid';

export interface LoanSummary {
  currentPayment: string;
  currentPaymentWithInsurance: string;
  solvedPayment: string | null;
  endDate: string;
  durationMonths: number;
  totals: {
    interest: string;
    insurance: string;
    fees: string;
    penalties: string;
    cost: string; // interest + insurance + fees + penalties
    totalPaid: string; // principal + cost
  };
  today: {
    asOf: string;
    capitalOwed: string;
    repaidPct: number;
    interestPaid: string;
    monthsLeft: number;
    nextInstalment: { date: string; amount: string } | null; // amount incl. insurance
    status: LoanStatus;
  };
}

export type LoanResult =
  | { ok: true; schedule: ScheduleRow[]; summary: LoanSummary; warnings: LoanWarning[] }
  | { ok: false; errors: LoanError[] };
