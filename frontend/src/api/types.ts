export type CategoryKind = 'expense' | 'income' | 'neutral';
export type SignConstraint = 'positive' | 'negative' | 'any';
export type MatchMode = 'word' | 'substring' | 'regex';
export type CategorySource = 'manual' | 'auto' | 'default' | 'llm';

export interface User {
  id: number;
  username: string;
}

export interface Account {
  id: number;
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  openingDate: string;
  currentBalance?: string;
  // Total transactions tied to this account (all dates).
  transactionCount?: number;
  // Transactions on/after openingDate — these are the ones actually summed
  // into currentBalance. If this is 0 but transactionCount > 0, the user has
  // rows dated before opening_date that are being excluded.
  countedTransactionCount?: number;
  // User-controlled position in the accounts grid / dashboard. Lower first.
  displayOrder?: number;
  createdAt?: string;
  // Default lock period in years. Applies to the opening balance and to
  // any transaction whose own lockYears is null. Clocked from openingDate.
  lockYears?: number | null;
  // Sum of amounts (including opening balance) that are unlocked as of
  // today. `blocked = currentBalance - availableBalance`.
  availableBalance?: string;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  color: string | null;
  parentId: number | null;
  isDefault: boolean;
  isInternalTransfer: boolean;
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

export interface TransactionSplit {
  id: number;
  transactionId: number;
  categoryId: number | null;
  amount: string;
  memo: string | null;
}

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  amount: string;
  rawLabel: string;
  normalizedLabel: string;
  memo: string | null;
  notes: string | null;
  fitid: string | null;
  dedupKey: string;
  categoryId: number | null;
  categorySource: CategorySource;
  transferGroupId: string | null;
  sourceFileId: number | null;
  importedAt: string;
  // Per-transaction lock override in years. Null falls back to the account's
  // lockYears; null on both means no lock. Clocked from the transaction date.
  lockYears?: number | null;
  // Account balance after this transaction (opening balance + cumulative sum
  // by date). Present only when the list is fetched with an accountId filter.
  runningBalance?: string;
  splits: TransactionSplit[];
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

export interface BalanceCheckpoint {
  id: number;
  accountId: number;
  checkpointDate: string;   // YYYY-MM-DD
  expectedAmount: string;   // fixed-point string, per project convention
  note: string | null;
  createdAt: string;
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
