import type { Category, CategoryReportRow } from '../../api/types';

export interface SankeyNode {
  key: string;
  label: string;
  amount: number;
  color: string | null;
  tone: 'category' | 'sage' | 'clay' | 'neutral';
}
export interface SankeyModel {
  incomeNodes: SankeyNode[];
  expenseNodes: SankeyNode[];
  savings: number;
  deficit: number;
  totalIncome: number;
  totalExpense: number;
  currency: string;
}
export interface BuildOpts { topNIncome?: number; topNExpense?: number; }

export const DEFAULT_TOP_N_INCOME = 4;
export const DEFAULT_TOP_N_EXPENSE = 6;

interface Group { id: number; label: string; color: string | null; amount: number; }

// Walk parentId chain to the top-most ancestor. Cycle-guarded.
function rootOf(cat: Category, byId: Map<number, Category>): Category {
  const seen = new Set<number>();
  let cur = cat;
  while (cur.parentId != null && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId)!;
  }
  return cur;
}

function bucketToNodes(
  groups: Map<number, Group>,
  topN: number,
  keyPrefix: string,
): SankeyNode[] {
  // Exclude groups with net amount <= 0: a Sankey ribbon cannot have negative width,
  // so categories that net to zero or negative over the period (e.g. expense groups
  // dominated by refunds) are intentionally excluded from both the node list and totals.
  const sorted = [...groups.values()].filter((g) => g.amount > 0).sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, topN);
  const tail = sorted.slice(topN);
  const nodes: SankeyNode[] = head.map((g) => ({
    key: `${keyPrefix}:${g.id}`, label: g.label, amount: g.amount, color: g.color, tone: 'category',
  }));
  if (tail.length > 0) {
    nodes.push({
      key: `${keyPrefix}:autres`, label: 'Autres',
      amount: tail.reduce((s, g) => s + g.amount, 0), color: null, tone: 'neutral',
    });
  }
  return nodes;
}

export function buildSankeyModel(
  rows: CategoryReportRow[],
  categories: Category[],
  currency: string,
  opts: BuildOpts = {},
): SankeyModel {
  const topNIncome = opts.topNIncome ?? DEFAULT_TOP_N_INCOME;
  const topNExpense = opts.topNExpense ?? DEFAULT_TOP_N_EXPENSE;
  const byId = new Map(categories.map((c) => [c.id, c]));

  const income = new Map<number, Group>();
  const expense = new Map<number, Group>();

  for (const r of rows) {
    if (r.category_id == null) continue;
    const cat = byId.get(r.category_id);
    if (!cat || cat.isInternalTransfer) continue;
    if (r.category_kind !== 'income' && r.category_kind !== 'expense') continue;
    const root = rootOf(cat, byId);
    const target = r.category_kind === 'income' ? income : expense;
    const value = r.category_kind === 'income' ? Number(r.total) : -Number(r.total);
    const g = target.get(root.id) ?? { id: root.id, label: root.name, color: root.color, amount: 0 };
    g.amount += value;
    target.set(root.id, g);
  }

  const incomeNodes = bucketToNodes(income, topNIncome, 'in');
  const expenseNodes = bucketToNodes(expense, topNExpense, 'out');
  const totalIncome = incomeNodes.reduce((s, n) => s + n.amount, 0);
  const totalExpense = expenseNodes.reduce((s, n) => s + n.amount, 0);

  return {
    incomeNodes,
    expenseNodes,
    savings: Math.max(0, totalIncome - totalExpense),
    deficit: Math.max(0, totalExpense - totalIncome),
    totalIncome,
    totalExpense,
    currency,
  };
}
