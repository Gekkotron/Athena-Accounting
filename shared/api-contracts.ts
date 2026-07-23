// Canonical shape of the entities returned by the API.
//
// Currently only the frontend (`frontend/src/api/types.ts`) imports from
// this file — the backend still derives its types from drizzle's
// `$inferSelect`. That's an intentional first step: the frontend used
// to hand-mirror the whole shape, so any DB rename went undetected
// until runtime. Now a rename requires updating this file *and* the
// backend's drizzle schema together, and the frontend catches the
// mismatch at compile time.
//
// The full plan (task 13 of the 2026-07-23 audit) is to have the
// backend consume this file too — that needs a `TypeScript solution`
// setup or npm workspaces so `shared/` can sit above both packages
// without breaking backend's `rootDir: src` dist layout. Left as a
// follow-up; extend this file rather than adding new bespoke
// interfaces to `api/types.ts`.
//
// Money amounts are strings (`"1234.56"`) because postgres numeric
// doesn't fit in JS number without losing 2-decimal precision.

export type CategoryKind = 'expense' | 'income' | 'neutral';
export type CategorySource = 'manual' | 'auto' | 'default' | 'llm';

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  color: string | null;
  parentId: number | null;
  isDefault: boolean;
  isInternalTransfer: boolean;
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
  lockYears?: number | null;
  runningBalance?: string;
  splits: TransactionSplit[];
}

export interface Account {
  id: number;
  name: string;
  type: string;
  currency: string;
  openingBalance: string;
  openingDate: string;
  currentBalance?: string;
  transactionCount?: number;
  countedTransactionCount?: number;
  displayOrder?: number;
  createdAt?: string;
  lockYears?: number | null;
  availableBalance?: string;
}

export interface BalanceCheckpoint {
  id: number;
  accountId: number;
  checkpointDate: string;   // YYYY-MM-DD
  expectedAmount: string;   // fixed-point string, per project convention
  note: string | null;
  createdAt: string;
}
