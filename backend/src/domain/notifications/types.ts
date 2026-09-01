// Mirrors shared/api-contracts.ts's Notification types. Kept as a manual,
// intentional duplicate (backend code does not import from shared/ — see
// frontend/src/api/types.ts for the frontend side of this same contract)
// rather than reaching across the backend/tsconfig.json `rootDir: "src"`
// boundary. Keep in sync by hand when the contract changes.

export type NotificationKind =
  | 'big_transaction'
  | 'account_low'
  | 'envelope_exceeded'
  | 'bank_sync_failed'
  | 'test';

// `accountName` / `categoryName` are set by the emitter (see
// emit.ts:enrichPayload) so the renderer can print the account or
// category as the user knows it instead of `account #12`. Optional so a
// legacy row stored before enrichment existed still renders (the
// renderer falls back to the id).
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
