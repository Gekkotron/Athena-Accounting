import { getState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { ApiError } from '../../../apiError';
import { consolidate } from '../../../../lib/fx';
import type { DemoFxRate } from '../../store';
import { enrichAccount, money, resolveDisplayCurrency, settingsDisplayCurrency, todayIso, txs } from './lib';

type PerCurrencyRow = { currency: string; total: string; available: string; invested: string; account_count: number };

const CONSOLIDATE_KEYS = ['total', 'available', 'invested'] as const;

// Mirrors backend/src/http/routes/reports/balance.ts's buildConsolidatedBlock.
function buildBalanceConsolidated(rows: PerCurrencyRow[], display: string, rates: DemoFxRate[], at: string) {
  const out = consolidate(rows, display, rates, at, CONSOLIDATE_KEYS);
  return {
    display: out.display,
    total: out.totals.total,
    available: out.totals.available,
    invested: out.totals.invested,
    unmapped: out.unmapped as PerCurrencyRow[],
  };
}

function handleAccounts() {
  const state = getState();
  const allTx = txs();
  return { accounts: state.accounts.map((a) => enrichAccount(a, allTx)) };
}

function handleAccountCheckpoints(req: DemoRequest) {
  const accountId = Number(req.query.accountId);
  const state = getState();
  const checkpoints = (state.balanceCheckpoints as Array<{ accountId: number }>).filter(
    (c) => c.accountId === accountId,
  );
  return { checkpoints };
}

function handleReportsBalance(req: DemoRequest) {
  const state = getState();
  const allTx = txs();
  const enriched = state.accounts.map((a) => enrichAccount(a, allTx));
  const byCurrency = new Map<string, { currency: string; total: number; available: number; invested: number; account_count: number }>();
  for (const a of enriched) {
    const cur = a.currency;
    const bucket = byCurrency.get(cur) ?? { currency: cur, total: 0, available: 0, invested: 0, account_count: 0 };
    bucket.total += Number(a.currentBalance ?? 0);
    bucket.available += Number(a.availableBalance ?? 0);
    // Mirrors backend reports/balance.ts: invested is the available part of
    // investment-type accounts only (their locked part counts as blocked).
    if (a.type === 'investment') {
      bucket.invested += Number(a.availableBalance ?? 0);
    }
    bucket.account_count += 1;
    byCurrency.set(cur, bucket);
  }
  const perCurrency: PerCurrencyRow[] = Array.from(byCurrency.values()).map((b) => ({
    currency: b.currency,
    total: money(b.total),
    available: money(b.available),
    invested: money(b.invested),
    account_count: b.account_count,
  }));

  const displayParam = req.query.display;
  const settingsDisplay = displayParam === undefined ? settingsDisplayCurrency(state) : null;
  const resolved = resolveDisplayCurrency(displayParam, settingsDisplay);
  if (resolved === 'invalid') {
    throw new ApiError('invalid display currency', 400, { error: 'invalid display currency' });
  }

  let consolidated: ReturnType<typeof buildBalanceConsolidated> | null = null;
  if (resolved !== null) {
    consolidated = buildBalanceConsolidated(perCurrency, resolved, state.fxRates ?? [], todayIso());
  }

  return { perCurrency, consolidated };
}

export function registerAccountsHandlers(): void {
  registerHandler('GET', '/api/accounts', handleAccounts);
  registerHandler('GET', '/api/accounts/:accountId/balance-checkpoints', handleAccountCheckpoints);
  registerHandler('GET', '/api/reports/balance', handleReportsBalance);
}
