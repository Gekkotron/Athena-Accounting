export type CategoryKind = 'expense' | 'income' | 'transfer' | 'neutral';
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
  createdAt?: string;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  color: string | null;
  parentId: number | null;
  isDefault: boolean;
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
  format: 'ofx' | 'csv';
  importedAt: string;
  totalLines: number;
  insertedCount: number;
  dedupSkipped: number;
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
  month: string;
  total: string;
  transaction_count: number;
}
