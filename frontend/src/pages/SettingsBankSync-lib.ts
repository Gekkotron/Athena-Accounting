// Pure helpers for the bank-sync settings section — no React imports.

export interface BankSyncAutoInfo {
  // False when the operator disabled the scheduler (BANK_SYNC_AUTO=0).
  enabled: boolean;
  // Configured local hour (server clock) — mirror of settings.bankSyncHour.
  hour: number;
  // Newest lastSyncedAt across the user's mapped accounts (previous fetch).
  lastSyncedAt: string | null;
  // Next scheduled occurrence; null when the scheduler is disabled.
  nextAt: string | null;
}

export interface BankSyncStatus {
  configured: boolean;
  applicationId: string | null;
  // Optional: absent on responses cached before the field shipped.
  autoSync?: BankSyncAutoInfo;
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
  // Sample (backend caps it) of the deduplicated rows — dedupSkipped is the true total.
  dedupSkippedRows: Array<{ date: string; amount: string; rawLabel: string }>;
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

// Mirror of the backend's redirect-URL logic (http/routes/bank-sync.ts):
// Enable Banking's Control Panel refuses plain http:// except localhost, so
// the URL we display for whitelisting — and the one the backend requests —
// is the https twin of a plain-http LAN origin.
export function consentRedirectUrl(origin: string): string {
  const url = new URL(origin);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const scheme = url.protocol === 'http:' && !isLocal ? 'https:' : url.protocol;
  return `${scheme}//${url.host}/bank-sync/callback`;
}

// Manual consent finalization: the bank's redirect can land on an
// unreachable page (e.g. the whitelisted URL doesn't match the address the
// user browses Athena at) — the authorization code is still in that page's
// URL. Accepts a full pasted URL or the bare code.
export function extractAuthCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (raw.includes('code=')) {
    try {
      const url = new URL(raw, 'http://placeholder.local');
      const code = url.searchParams.get('code');
      return code && code.trim() ? code.trim() : null;
    } catch {
      return null;
    }
  }
  // A bare code never contains separators a URL would have.
  if (/\s|\/|\?/.test(raw)) return null;
  return raw;
}

// Display label for a bank account row in the mapping UI.
export function bankAccountLabel(a: BankConnectionAccount): string {
  const name = a.name?.trim() || a.iban?.trim() || a.bankAccountUid;
  return a.currency ? `${name} (${a.currency})` : name;
}

// Soonest-expiring connection still inside the pre-expiry warning window —
// drives the tab-level reconnect banner. Connections already flagged
// needs_reconnect have their own 'required' chip and are excluded here.
export function soonestExpiring(
  connections: BankConnection[],
  todayIso: string,
): BankConnection | null {
  const soon = connections.filter(
    (c) => connectionChipState(c.status, c.validUntil, todayIso) === 'soon',
  );
  if (soon.length === 0) return null;
  return soon.reduce((a, b) => (a.validUntil <= b.validUntil ? a : b));
}
