// The highest-drift-risk entities (Account, Category, Transaction,
// TransactionSplit, BalanceCheckpoint) now live in ../../../shared/ so the
// backend routes and this file share one source of truth. Additions to
// those entities go in the shared file. Everything else in this module is
// still hand-rolled — task 13 of the 2026-07-23 audit tracks porting the
// rest.
import type { CategoryKind } from '../../../shared/api-contracts';
export type {
  Account,
  BalanceCheckpoint,
  Category,
  CategoryKind,
  CategorySource,
  Transaction,
  TransactionSplit,
} from '../../../shared/api-contracts';

export type SignConstraint = 'positive' | 'negative' | 'any';
export type MatchMode = 'word' | 'substring' | 'regex';

export interface User {
  id: number;
  username: string;
}

export interface Rule {
  id: number;
  categoryId: number;
  keyword: string;
  signConstraint: SignConstraint;
  matchMode: MatchMode;
  priority: number;
  enabled: boolean;
  createdAt: string;
}

export interface TransferRule {
  id: number;
  keyword: string;
  direction: 'outgoing' | 'incoming';
  counterpartAccountId: number | null;
  enabled: boolean;
}

export interface AccountFilenamePattern {
  id: number;
  pattern: string;
  accountId: number;
  priority: number;
}

export interface FileImport {
  id: number;
  filename: string;
  accountId: number;
  format: 'ofx' | 'csv' | 'pdf';
  importedAt: string;
  totalLines: number;
  insertedCount: number;
  dedupSkipped: number;
  // Reconciliation: the closing balance printed on the statement (set by the
  // user post-import) and the matching "as of" date. computedBalance and delta
  // are derived server-side from accounts.opening_balance + sum of transactions
  // up to statedBalanceDate.
  statedBalance: string | null;
  statedBalanceDate: string | null;
  computedBalance: string | null;
  delta: string | null;
}

export interface TriGroup {
  normalized_label: string;
  transaction_count: number;
  total_amount: string;
  example_raw_label: string;
  example_id: number;
  min_date: string;
  max_date: string;
}

export interface BalancePoint {
  account_id: number;
  currency: string;
  bucket: string;
  delta: string;
  cumulative: string;
}

export interface CategoryReportRow {
  category_id: number | null;
  category_name: string | null;
  category_kind: CategoryKind | null;
  category_is_internal_transfer: boolean | null;
  month: string;
  total: string;
  transaction_count: number;
}

export type BudgetPeriod = 'monthly' | 'yearly';

export type Budget = {
  id: number;
  categoryId: number;
  monthlyLimit: string;
  currency: string;
  period: BudgetPeriod;
  accountId: number | null;
};

export type BudgetReportRow = {
  id: number;
  categoryId: number;
  name: string;
  color: string | null;
  parentId: number | null;
  accountId: number | null;
  period: BudgetPeriod;
  limit: string;
  currency: string;
  spent: string;
  remaining: string;
  pct: number;
  over: boolean;
  projected: string | null;
  history: { values: string[]; average: string; median: string } | null;
  anomaly: boolean;
  suggestedLimit: string | null;
};

export type BudgetReport = {
  period: BudgetPeriod;
  month?: string;
  year?: string;
  windowDays: number;
  elapsedDays: number;
  rows: BudgetReportRow[];
  totals: { limit: string; spent: string; remaining: string; projected: string | null };
  unbudgetedCandidates: {
    categoryId: number; name: string; color: string | null;
    parentId: number | null; average: string;
  }[];
};

export type TargetKind = 'save_by_date' | 'monthly_recurring' | 'save_up_to';
export type OverspendPolicy = 'rollover_negative' | 'reallocate_manual';

export interface EnvelopeAssignment {
  id: number;
  categoryId: number;
  month: string;
  amount: string;
  currency: string;
}

export interface EnvelopeCategorySettings {
  categoryId: number;
  targetAmount: string | null;
  targetDate: string | null;
  targetKind: TargetKind | null;
  overspendPolicy: OverspendPolicy;
}

export interface EnvelopeHold {
  month: string;
  amount: string;
}

export interface EnvelopeReportRow {
  categoryId: number;
  categoryName: string;
  balancePriorMonth: string;
  assignment: string;
  spend: string;
  balance: string;
  target: { amount: string; date: string | null; kind: TargetKind } | null;
  overspendPolicy: OverspendPolicy;
  overspent: boolean;
  absorbedByPool: string;
  monthsToTarget: number | null;
}

export type RecurringStatus = 'detected' | 'confirmed' | 'dismissed';
export type RecurringEssentialness = 'essential' | 'discretionary';

export interface RecurringSeries {
  id: number;
  label: string;
  cadenceDays: number;
  avgAmount: string;
  amountStddev: string;
  categoryId: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  nextDueAt: string;
  status: RecurringStatus;
  essentialness: RecurringEssentialness | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  // Majority-vote account across this series' member transactions, or
  // null when the series has no members or the split is even. Lets the
  // forecast filter out series that don't actually hit the currently
  // scoped account (e.g. a salary lands on Checking, so it shouldn't
  // inflate the Savings projection).
  primaryAccountId: number | null;
}

export interface EnvelopeReport {
  month: string;
  pool: {
    incomeCumulative: string;
    assignedCumulative: string;
    heldFromPriorMonths: string;
    heldForNextMonth: string;
    available: string;
  };
  rows: EnvelopeReportRow[];
}
