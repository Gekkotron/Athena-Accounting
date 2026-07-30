// Pure helpers for the bank-sync settings section — no React imports.

export interface BankSyncStatus {
  configured: boolean;
  applicationId: string | null;
}

export interface BankConnectionAccount {
  bankAccountUid: string;
  iban: string | null;
  name: string | null;
  currency: string | null;
  accountId: number | null;
  lastSyncedAt: string | null;
}

export interface BankConnection {
  id: number;
  aspspName: string;
  aspspCountry: string;
  validUntil: string;
  status: 'active' | 'needs_reconnect';
  createdAt: string;
  accounts: BankConnectionAccount[];
}

export interface SyncAccountResult {
  bankAccountUid: string;
  accountId: number | null;
  imported: number;
  dedupSkipped: number;
  skipped: 'unmapped' | null;
}

export interface SyncConnectionResult {
  connectionId: number;
  aspspName: string;
  status: 'ok' | 'needs_reconnect' | 'error';
  accounts: SyncAccountResult[];
  error?: string;
}

// Consent lifecycle chip shown on each connection card. 'required' when the
// backend flagged the connection (or the date already lapsed); 'soon' inside
// the pre-expiry warning window; 'ok' otherwise.
export const RECONNECT_WARNING_DAYS = 14;

export type ConnectionChipState = 'ok' | 'soon' | 'required';

export function connectionChipState(
  status: BankConnection['status'],
  validUntil: string,
  todayIso: string,
): ConnectionChipState {
  if (status === 'needs_reconnect' || validUntil < todayIso) return 'required';
  const warnFrom = new Date(`${todayIso}T00:00:00Z`);
  warnFrom.setUTCDate(warnFrom.getUTCDate() + RECONNECT_WARNING_DAYS);
  if (validUntil <= warnFrom.toISOString().slice(0, 10)) return 'soon';
  return 'ok';
}

// Display label for a bank account row in the mapping UI.
export function bankAccountLabel(a: BankConnectionAccount): string {
  const name = a.name?.trim() || a.iban?.trim() || a.bankAccountUid;
  return a.currency ? `${name} (${a.currency})` : name;
}
