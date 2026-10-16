import type { loans } from '../../db/schema.js';
import type {
  EarlyRepayment,
  FinalPeriod,
  FixedPeriod,
  InsuranceBasis,
  LoanTerms,
} from './engine/index.js';

export const LOAN_KINDS = ['mortgage', 'consumer', 'auto', 'other'] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];
export type LoanRow = typeof loans.$inferSelect;

// Wire shape of a saved loan. Mirrored in shared/api-contracts.ts as `Loan`.
export interface LoanRecord {
  id: number;
  name: string;
  kind: LoanKind;
  isSimulation: boolean;
  sourceLoanId: number | null;
  currency: string;
  principal: string;
  startDate: string;
  annualRate: string;
  insuranceRate: string;
  insuranceBasis: InsuranceBasis;
  fees: string;
  periods: FixedPeriod[];
  finalPeriod: FinalPeriod;
  earlyRepayments: EarlyRepayment[];
  createdAt: string;
  updatedAt: string;
}

// numeric(7,4) comes back as "3.5000"; echo "3.5" so the editor shows what
// the user typed rather than padded zeros.
export function trimDecimal(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function toRecord(row: LoanRow): LoanRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as LoanKind,
    isSimulation: row.isSimulation,
    sourceLoanId: row.sourceLoanId,
    currency: row.currency,
    principal: row.principal,
    startDate: row.startDate,
    annualRate: trimDecimal(row.annualRate),
    insuranceRate: trimDecimal(row.insuranceRate),
    insuranceBasis: row.insuranceBasis as InsuranceBasis,
    fees: row.fees,
    periods: row.periods,
    finalPeriod: row.finalPeriod,
    earlyRepayments: row.earlyRepayments,
    // PGlite and node-pg disagree on TIMESTAMPTZ representation; normalise.
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

// Engine input from any object carrying the loan terms (a record, a parsed
// request body). Copies only engine fields so extra keys never leak in.
export function toTerms(t: LoanTerms): LoanTerms {
  return {
    principal: t.principal,
    startDate: t.startDate,
    annualRate: t.annualRate,
    insuranceRate: t.insuranceRate,
    insuranceBasis: t.insuranceBasis,
    fees: t.fees,
    periods: t.periods,
    finalPeriod: t.finalPeriod,
    earlyRepayments: t.earlyRepayments,
  };
}

// The server's local calendar date: the app runs on the user's own machine,
// so "today" is their today, not UTC's.
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
