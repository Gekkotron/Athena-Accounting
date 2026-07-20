import { getState } from '../../store';
import { registerHandler, type DemoRequest } from '../../index';
import { applyTxFilters, attachRunningBalance, parseTxFilters, txs } from './lib';

function handleTransactions(req: DemoRequest) {
  const state = getState();
  const { filters, limit, offset } = parseTxFilters(req.query);
  const all = applyTxFilters(txs(), filters);
  const chrono = [...all].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const page = chrono.slice(offset, offset + limit);
  const enriched = filters.accountId != null ? attachRunningBalance(page, filters.accountId, state) : page;
  return {
    transactions: enriched,
    pagination: { total: all.length, limit, offset },
  };
}

export function registerTransactionsHandlers(): void {
  registerHandler('GET', '/api/transactions', handleTransactions);
}
