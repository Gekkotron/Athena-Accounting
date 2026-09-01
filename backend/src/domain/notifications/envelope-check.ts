import { fetchBudgetRows } from '../../http/routes/reports/budget-queries.js';

// Reuses the exact aggregate that powers GET /api/reports/budget's spend
// rollup (category_budgets joined against the tx_effective CTE), scoped to
// the current calendar month, a single category, and the transaction's own
// account — no separate query is invented. A category with no monthly
// budget row returns envelope: null (nothing to compare against, so the
// caller skips the notification).
//
// `category_budgets` allows a category to carry BOTH a global budget row
// (account_id IS NULL) and an account-scoped row for the same category at
// once (two independent partial-unique indexes — see db/schema.ts). Passing
// `accountId` through to `fetchBudgetRows` scopes the spend aggregate to
// that account for both rows; when both a scoped and a global row come
// back for the category, the scoped one wins — matching the envelope a
// single-account Budget view would show.
export async function computeEnvelope(
  userId: number,
  categoryId: number,
  accountId: number,
): Promise<{ spent: number; envelope: number | null; month: string }> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const startIso = `${month}-01`;
  const endIso = new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString().slice(0, 10);

  const rows = await fetchBudgetRows(userId, 'monthly', startIso, endIso, accountId);
  const matches = rows.filter((r) => r.category_id === categoryId);
  const row = matches.find((r) => r.account_id === accountId) ?? matches.find((r) => r.account_id === null);
  if (!row) return { spent: 0, envelope: null, month };
  return { spent: Number(row.spent), envelope: Number(row.limit), month };
}
