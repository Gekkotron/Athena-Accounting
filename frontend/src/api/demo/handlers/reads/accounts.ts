import { getState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { enrichAccount, money, txs } from './lib';

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

function handleReportsBalance() {
  const state = getState();
  const allTx = txs();
  const enriched = state.accounts.map((a) => enrichAccount(a, allTx));
  const byCurrency = new Map<string, { currency: string; total: number; available: number; invested: number; account_count: number }>();
  for (const a of enriched) {
    const cur = a.currency;
    const bucket = byCurrency.get(cur) ?? { currency: cur, total: 0, available: 0, invested: 0, account_count: 0 };
    bucket.total += Number(a.currentBalance ?? 0);
    bucket.available += Number(a.availableBalance ?? 0);
    if (a.type === 'savings' || a.type === 'investment') {
      bucket.invested += Number(a.currentBalance ?? 0);
    }
    bucket.account_count += 1;
    byCurrency.set(cur, bucket);
  }
  return {
    perCurrency: Array.from(byCurrency.values()).map((b) => ({
      currency: b.currency,
      total: money(b.total),
      available: money(b.available),
      invested: money(b.invested),
      account_count: b.account_count,
    })),
  };
}

export function registerAccountsHandlers(): void {
  registerHandler('GET', '/api/accounts', handleAccounts);
  registerHandler('GET', '/api/accounts/:accountId/balance-checkpoints', handleAccountCheckpoints);
  registerHandler('GET', '/api/reports/balance', handleReportsBalance);
}
