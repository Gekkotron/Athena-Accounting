import type { Account, Category, Transaction } from '../../../types';
import { getState, type DemoState } from '../../store';
import { todayLocalIso } from '../../../../lib/dates';

// Amounts are stored as fixed-point strings; conversion to Number for
// aggregation is safe within the demo's small dataset. When emitting a
// numeric string back out we go through toFixed(2) so shapes stay canonical.
export const money = (n: number): string => (n < 0 ? '-' : '') + Math.abs(n).toFixed(2);

export function txs(): Transaction[] {
  return getState().transactions as unknown as Transaction[];
}

export function categoryById(id: number | null | undefined, state: DemoState): Category | null {
  if (id == null) return null;
  return state.categories.find((c) => c.id === id) ?? null;
}

export function bucketFor(date: string, granularity: 'day' | 'week' | 'month'): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  // week: ISO Monday-start grouping via YYYY-MM-DD of the Monday.
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = dt.getUTCDay() || 7; // Sun=7
  dt.setUTCDate(dt.getUTCDate() - (dayOfWeek - 1));
  return dt.toISOString().slice(0, 10);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

// Resolves the effective display currency the same way the backend's
// /api/reports/* routes do (backend/src/http/routes/reports/balance.ts): an
// explicit `?display=` query param wins ('none' → no conversion, a 3-letter
// code → that currency), falling back to the settings value when the param
// is absent. Returns 'invalid' for anything else, so the caller can 400.
export function resolveDisplayCurrency(
  displayParam: string | undefined,
  settingsDisplay: string | null,
): string | null | 'invalid' {
  if (displayParam === undefined) return settingsDisplay;
  if (displayParam === 'none') return null;
  if (/^[A-Z]{3}$/.test(displayParam)) return displayParam;
  return 'invalid';
}

// Reads settings.displayCurrency off demo state, defaulting missing/undefined
// to null (per-currency mode) — mirrors the backend's loadUserDisplayCurrency.
export function settingsDisplayCurrency(state: DemoState): string | null {
  return (state.settings as { displayCurrency?: string | null }).displayCurrency ?? null;
}

// Add `daysCount` days to an ISO YYYY-MM-DD, UTC-safe.
export function addDaysIso(iso: string, daysCount: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + daysCount * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function todayIso(): string {
  // Demo mode uses the seeded SEED_TODAY when present so upcoming/forecast
  // views render with the same anchor the transaction seed uses.
  const state = getState();
  const s = state.settings as { seedTodayForDemo?: string };
  return s.seedTodayForDemo ?? todayLocalIso();
}

// Recompute next_due_at at read time when ?upcoming=N is set. Walks forward
// from lastSeen in cadence-day steps until the next date is strictly ≥ today.
// Mirrors the backend logic in routes/recurring.ts.
export function nextDueFrom(lastSeen: string, cadenceDays: number, today: string): string {
  let next = lastSeen;
  for (let i = 0; i < 5000; i++) {
    if (next >= today) return next;
    next = addDaysIso(next, cadenceDays);
  }
  return next;
}

// Add years to an ISO YYYY-MM-DD, clamping to the target month's last day
// (Feb 29 + 1 year → Feb 28) the way Postgres `date + interval 'N years'`
// does — the backend lock computations use that operator.
export function addYearsIso(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const target = y + years;
  const lastDay = new Date(Date.UTC(target, m, 0)).getUTCDate();
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${target}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
}

// Enrich an account row with computed currentBalance (opening + counted
// deltas), transactionCount (raw), countedTransactionCount (post-openingDate),
// and availableBalance. The available/blocked decomposition mirrors the
// backend (accounts/list.ts): the opening balance is available iff the
// account-level lock is absent or expired; each transaction follows its own
// lockYears when set, else the account's.
export function enrichAccount(acc: Account, allTx: Transaction[]): Account {
  const opening = Number(acc.openingBalance);
  const mine = allTx.filter((t) => t.accountId === acc.id);
  const counted = mine.filter((t) => t.date >= acc.openingDate);
  const currentBalance = counted.reduce((s, t) => s + Number(t.amount), opening);
  const today = todayIso();
  const accountUnlocked =
    acc.lockYears == null || addYearsIso(acc.openingDate, acc.lockYears) <= today;
  const availableBalance = counted.reduce(
    (s, t) => {
      const unlocked = t.lockYears != null
        ? addYearsIso(t.date, t.lockYears) <= today
        : accountUnlocked;
      return unlocked ? s + Number(t.amount) : s;
    },
    accountUnlocked ? opening : 0,
  );
  return {
    ...acc,
    currentBalance: money(currentBalance),
    transactionCount: mine.length,
    countedTransactionCount: counted.length,
    availableBalance: money(availableBalance),
  };
}

export interface TxFilters {
  accountId?: number;
  from?: string;
  to?: string;
  q?: string;
  categoryId?: number | null;
  uncategorized?: boolean;
}

export function parseTxFilters(q: Record<string, string>): { filters: TxFilters; limit: number; offset: number } {
  const filters: TxFilters = {};
  if (q.accountId) filters.accountId = Number(q.accountId);
  if (q.from) filters.from = q.from;
  if (q.to) filters.to = q.to;
  if (q.q) filters.q = q.q.toLowerCase();
  if (q.categoryId === 'null' || q.uncategorized === 'true') filters.uncategorized = true;
  else if (q.categoryId) filters.categoryId = Number(q.categoryId);
  const limit = q.limit ? Math.max(1, Math.min(500, Number(q.limit))) : 50;
  const offset = q.offset ? Math.max(0, Number(q.offset)) : 0;
  return { filters, limit, offset };
}

export function applyTxFilters(list: Transaction[], f: TxFilters): Transaction[] {
  return list.filter((t) => {
    if (f.accountId != null && t.accountId !== f.accountId) return false;
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.uncategorized && t.categoryId != null) return false;
    if (f.categoryId != null && t.categoryId !== f.categoryId) return false;
    if (f.q && !t.rawLabel.toLowerCase().includes(f.q) && !t.normalizedLabel.includes(f.q)) return false;
    return true;
  });
}

export function attachRunningBalance(list: Transaction[], accountId: number, state: DemoState): Transaction[] {
  const acc = state.accounts.find((a) => a.id === accountId);
  if (!acc) return list;
  const chrono = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let running = Number(acc.openingBalance);
  const rbById = new Map<number, string>();
  for (const t of chrono) {
    if (t.date < acc.openingDate) continue;
    running += Number(t.amount);
    rbById.set(t.id, money(running));
  }
  return list.map((t) => (rbById.has(t.id) ? { ...t, runningBalance: rbById.get(t.id)! } : t));
}

// Majority-vote account across transactions whose rawLabel matches the
// series label. Returns null when there are no matches or an even split
// where nothing dominates. Recomputed at read time so stale localStorage
// snapshots (from visits made before primaryAccountId existed on the type)
// and any runtime state mutations both surface the current attribution.
export function computePrimaryAccountId(label: string, transactions: Transaction[]): number | null {
  const counts = new Map<number, number>();
  for (const t of transactions) {
    if (t.rawLabel !== label) continue;
    counts.set(t.accountId, (counts.get(t.accountId) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [id, cnt] of counts) {
    if (cnt > bestCount) {
      bestCount = cnt;
      best = id;
    }
  }
  return best;
}
