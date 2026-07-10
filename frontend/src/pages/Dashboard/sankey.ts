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

export interface LaidOutNode {
  key: string; label: string; amount: number; color: string | null;
  tone: SankeyNode['tone'];
  column: 'left' | 'center' | 'right';
  x: number; y: number; w: number; h: number;
}
export interface LaidOutLink {
  key: string; sourceKey: string; targetKey: string;
  path: string; width: number; color: string | null;
}
export interface SankeyLayout { nodes: LaidOutNode[]; links: LaidOutLink[]; width: number; height: number; }
export interface LayoutOpts { width?: number; height?: number; nodeWidth?: number; gap?: number; minNodeHeight?: number; }

// Cubic-Bézier centre-to-centre ribbon spine. Stroke width carries the amount.
function spine(x0: number, y0: number, x1: number, y1: number): string {
  const xm = (x0 + x1) / 2;
  return `M ${x0} ${y0} C ${xm} ${y0}, ${xm} ${y1}, ${x1} ${y1}`;
}

export function layoutSankey(model: SankeyModel, opts: LayoutOpts = {}): SankeyLayout {
  const width = opts.width ?? 640;
  const height = opts.height ?? 320;
  const nodeWidth = opts.nodeWidth ?? 14;
  const gap = opts.gap ?? 6;
  const minNodeHeight = opts.minNodeHeight ?? 2;

  // Left = income sources (+ deficit source); right = expenses (+ savings).
  const leftNodes: SankeyNode[] = [...model.incomeNodes];
  if (model.deficit > 0) {
    leftNodes.push({ key: 'in:deficit', label: 'Épargne puisée', amount: model.deficit, color: null, tone: 'clay' });
  }
  const rightNodes: SankeyNode[] = [...model.expenseNodes];
  if (model.savings > 0) {
    rightNodes.push({ key: 'out:savings', label: 'Épargne', amount: model.savings, color: null, tone: 'sage' });
  }

  const grandTotal = leftNodes.reduce((s, n) => s + n.amount, 0) || 1;
  const maxNodes = Math.max(leftNodes.length, rightNodes.length);
  const gapBudget = Math.max(0, maxNodes - 1) * gap;
  const pxPerUnit = (height - gapBudget) / grandTotal;

  const stack = (col: SankeyNode[], x: number, column: LaidOutNode['column'], pxPerUnit: number): LaidOutNode[] => {
    const out: LaidOutNode[] = [];
    let y = 0;
    for (const n of col) {
      const h = Math.max(minNodeHeight, n.amount * pxPerUnit);
      out.push({ ...n, column, x, y, w: nodeWidth, h });
      y += h + gap;
    }
    return out;
  };

  const left = stack(leftNodes, 0, 'left', pxPerUnit);
  const right = stack(rightNodes, width - nodeWidth, 'right', pxPerUnit);

  // Center pool spans the full height (its amount == grandTotal).
  const pool: LaidOutNode = {
    key: 'pool', label: 'Revenus', amount: grandTotal, color: null, tone: 'category',
    column: 'center', x: (width - nodeWidth) / 2, y: 0, w: nodeWidth, h: height,
  };

  const nodes = [...left, pool, ...right];

  // Links: each left node -> pool, pool -> each right node. Centre-to-centre.
  const links: LaidOutLink[] = [];
  const poolCx0 = pool.x;
  const poolCx1 = pool.x + pool.w;
  for (const n of left) {
    links.push({
      key: `${n.key}->pool`, sourceKey: n.key, targetKey: 'pool',
      path: spine(n.x + n.w, n.y + n.h / 2, poolCx0, n.y + n.h / 2),
      width: Math.max(1, n.h), color: n.color,
    });
  }
  for (const n of right) {
    links.push({
      key: `pool->${n.key}`, sourceKey: 'pool', targetKey: n.key,
      path: spine(poolCx1, n.y + n.h / 2, n.x, n.y + n.h / 2),
      width: Math.max(1, n.h), color: n.color,
    });
  }

  return { nodes, links, width, height };
}
