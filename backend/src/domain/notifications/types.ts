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

export type NotificationPayload =
  | { kind: 'big_transaction'; single: { txId: number; accountId: number; amount: number; merchant: string | null } }
  | { kind: 'big_transaction'; summary: { accountId: number; count: number; total: number } }
  | { kind: 'account_low'; accountId: number; balance: number; floor: number }
  | { kind: 'envelope_exceeded'; categoryId: number; envelope: number; spent: number; month: string }
  | { kind: 'bank_sync_failed'; accountId: number; reason: string }
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
