import type { Account, BalancePoint } from '../../api/types';

// Look back N complete months (excludes the current month, since a
// half-finished month drags the average toward zero).
export const AVG_WINDOW_MONTHS = 12;

// Mirrors the backend's "available" concept (see accounts/list.ts): an
// account's balance is currently in-play iff it has no lock, or its lock
// window has elapsed. Used to resolve the Dashboard's 'available' chart
// scope into an id list.
export function isAccountAvailable(a: Account, today: Date = new Date()): boolean {
  const years = a.lockYears;
  if (years == null) return true;
  // openingDate is 'YYYY-MM-DD'. Compare in UTC so a laptop crossing a
  // timezone during the lock window doesn't wobble by a day.
  const [y, m, d] = a.openingDate.split('-').map(Number);
  if (!y || !m || !d) return true; // malformed date: fall open (matches the SQL's OR-null tolerance)
  const unlockAt = Date.UTC(y + years, m - 1, d);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return unlockAt <= todayUtc;
}

// ISO date (YYYY-MM-DD) at which the account's opening balance becomes
// available, or null when it was never locked.
export function accountUnlockDate(a: Account): string | null {
  if (a.lockYears == null) return null;
  const [y, m, d] = a.openingDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  // padStart so JS's default numeric formatting doesn't collapse the month.
  const yy = String(y + a.lockYears).padStart(4, '0');
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// For the Dashboard's 'available' chart scope: build the historical curve
// of "Disponible" (matches the hero's figure at today's date). Two things
// happen on top of the standard aggregate:
//   1. Investment accounts (type = 'investment') are excluded entirely —
//      they're the "Placé" tier the hero subtracts from `available` to get
//      Disponible (see backend/reports/balance.ts).
//   2. A locked account contributes zero before its unlock date, then its
//      full balance on/after. On a sparse-point account (livret with the
//      odd interest deposit, no daily entries) the first post-unlock
//      BalancePoint can land well after the unlock date, so we inject a
//      synthetic zero-delta baseline AT the unlock date carrying the last
//      known pre-unlock cumulative — the aggregate then steps up on the
//      unlock date instead of staying flat until the next entry.
// This is still an account-level approximation of the SQL rule: per-
// transaction lockYears (rare) aren't reflected.
export function filterToAvailableOverTime(
  points: BalancePoint[],
  accounts: Account[],
): BalancePoint[] {
  const investmentAccIds = new Set<number>();
  const unlockDateByAcc = new Map<number, string | null>();
  for (const a of accounts) {
    if (a.type === 'investment') investmentAccIds.add(a.id);
    unlockDateByAcc.set(a.id, accountUnlockDate(a));
  }

  const out: BalancePoint[] = [];
  const lastPreUnlock = new Map<number, BalancePoint>();
  const hasAtUnlock = new Set<number>();

  for (const p of points) {
    if (investmentAccIds.has(p.account_id)) continue;
    const unlock = unlockDateByAcc.get(p.account_id);
    if (unlock == null) {
      out.push(p);
      continue;
    }
    if (p.bucket < unlock) {
      const prev = lastPreUnlock.get(p.account_id);
      if (!prev || p.bucket > prev.bucket) lastPreUnlock.set(p.account_id, p);
    } else {
      out.push(p);
      if (p.bucket === unlock) hasAtUnlock.add(p.account_id);
    }
  }
  for (const [accId, p] of lastPreUnlock) {
    if (hasAtUnlock.has(accId)) continue;
    const unlock = unlockDateByAcc.get(accId);
    if (!unlock) continue;
    out.push({ ...p, bucket: unlock, delta: '0' });
  }
  return out;
}

export function monthAgoISODate(monthsBack: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Last day of the PREVIOUS month, so the current (half-finished) month is
// excluded from the sliding window entirely. Prior version returned the 1st
// of the current month and let a `<=` filter leak day-1 transactions in.
export function lastDayOfPrevMonthISODate(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
