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
  // Count of transaction_attachments rows on this transaction; hydrated by
  // the list/get handlers. Optional so pre-attachments-feature payloads and
  // test fixtures still validate — a missing value reads as "0 attachments",
  // matching the paperclip-indicator hide behaviour on the row.
  attachmentCount?: number;
}

export interface Attachment {
  id: number;
  transactionId: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
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

// Savings goals (migration 0037). A goal is a "layer of intent" over an
// account's real balance — its progress is the sum of explicit contribution
// and withdrawal events, not a fraction of the account balance. Amounts stay
// fixed-point strings per the project's numeric-precision convention.
export interface SavingsGoal {
  id: number;
  accountId: number;
  name: string;
  targetAmount: string;
  targetDate: string | null;      // YYYY-MM-DD
  color: string | null;
  closedAt: string | null;        // ISO string; non-null = archived
  currency: string;               // inherited from the account
  savedAmount: string;            // SUM(events.amount)
  eventCount: number;
  rawPct: number;                 // real ratio (unclamped)
  progressPct: number;            // clamped to [0, 100] for the bar
  perMonthNeeded: string | null;  // null when no deadline / already met
  overdueDays: number | null;     // null unless past deadline AND under target
}

export interface SavingsGoalEvent {
  id: number;
  goalId: number;
  amount: string;    // signed: positive = contribution, negative = withdrawal
  eventDate: string; // YYYY-MM-DD
  note: string | null;
  createdAt: string;
}

// Notifications (migration 0040). Emitters upsert-guard on (userId,
// idempotency) so the same event never fires twice.
export type NotificationKind =
  | 'big_transaction'
  | 'account_low'
  | 'envelope_exceeded'
  | 'bank_sync_failed'
  | 'test';

// `accountName` / `categoryName` are set by the emitter (see
// backend/src/domain/notifications/emit.ts:enrichPayload) so the renderer
// can print the account or category as the user knows it instead of
// `account #12`. Optional so a legacy row stored before enrichment
// existed still renders (the renderer falls back to the id).
export type NotificationPayload =
  | { kind: 'big_transaction'; single: { txId: number; accountId: number; accountName?: string; amount: number; merchant: string | null } }
  | { kind: 'big_transaction'; summary: { accountId: number; accountName?: string; count: number; total: number } }
  | { kind: 'account_low'; accountId: number; accountName?: string; balance: number; floor: number }
  | { kind: 'envelope_exceeded'; categoryId: number; categoryName?: string; envelope: number; spent: number; month: string }
  | { kind: 'bank_sync_failed'; accountId: number; accountName?: string; reason: string }
  | { kind: 'test' };

export interface Notification {
  id: number;
  kind: NotificationKind;
  payload: NotificationPayload;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
