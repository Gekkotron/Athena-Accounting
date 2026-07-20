import { getState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { addDaysIso, computePrimaryAccountId, nextDueFrom, todayIso, txs } from './lib';

function handleRecurring(req: DemoRequest) {
  const state = getState();
  const transactions = txs();
  // Always overwrite primaryAccountId from the current transactions so the
  // value stays honest across schema bumps and old localStorage.
  const rows = (state.recurring ?? []).map((r) => ({
    ...r,
    primaryAccountId: computePrimaryAccountId(r.label, transactions),
  }));
  const upcomingRaw = req.query.upcoming;

  if (upcomingRaw !== undefined && upcomingRaw !== '') {
    const raw = Number(upcomingRaw);
    if (!Number.isFinite(raw) || raw <= 0) return { recurring: [] };
    const horizon = Math.min(180, Math.floor(raw));
    const today = todayIso();
    const cutoff = addDaysIso(today, horizon);
    const withNext = rows.map((r) => ({
      ...r,
      nextDueAt: nextDueFrom(r.lastSeenAt, r.cadenceDays, today),
    }));
    const filtered = withNext.filter((r) => r.nextDueAt <= cutoff);
    filtered.sort((a, b) => a.nextDueAt.localeCompare(b.nextDueAt));
    return { recurring: filtered };
  }

  // Default: ordered by ABS(monthly-equivalent) desc, matching the backend.
  const sorted = [...rows].sort((a, b) => {
    const eqA = Math.abs(Number(a.avgAmount) * (30 / a.cadenceDays));
    const eqB = Math.abs(Number(b.avgAmount) * (30 / b.cadenceDays));
    return eqB - eqA;
  });
  return { recurring: sorted };
}

export function registerRecurringHandlers(): void {
  registerHandler('GET', '/api/recurring', handleRecurring);
}
