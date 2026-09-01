import { fetchBudgetRows } from '../../http/routes/reports/budget-queries.js';

// Reuses the exact aggregate that powers GET /api/reports/budget's spend
// rollup (category_budgets joined against the tx_effective CTE), scoped to
// the current calendar month and a single category — no separate query is
// invented. A category with no monthly budget row returns envelope: null
// (nothing to compare against, so the caller skips the notification).
export async function computeEnvelope(
  userId: number,
  categoryId: number,
): Promise<{ spent: number; envelope: number | null; month: string }> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const startIso = `${month}-01`;
  const endIso = new Date(Date.UTC(year, monthIndex + 1, 1)).toISOString().slice(0, 10);

  const rows = await fetchBudgetRows(userId, 'monthly', startIso, endIso, null);
  const row = rows.find((r) => r.category_id === categoryId);
  if (!row) return { spent: 0, envelope: null, month };
  return { spent: Number(row.spent), envelope: Number(row.limit), month };
}
