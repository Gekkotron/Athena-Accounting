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
    const parsed = Number(r.total);
    if (!Number.isFinite(parsed)) continue;
    const root = rootOf(cat, byId);
    const target = r.category_kind === 'income' ? income : expense;
    const value = r.category_kind === 'income' ? parsed : -parsed;
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

// Filled Sankey ribbon: two cubic-bezier curves (top + bottom) connecting a
// source segment [top0..bot0] at x0 to a target segment [top1..bot1] at x1,
// closed into a filled area. Width of the ribbon carries the amount at each end.
function ribbonPath(
  x0: number, top0: number, bot0: number,
  x1: number, top1: number, bot1: number,
): string {
  const xm = (x0 + x1) / 2;
  return (
    `M ${x0} ${top0} ` +
    `C ${xm} ${top0}, ${xm} ${top1}, ${x1} ${top1} ` +
    `L ${x1} ${bot1} ` +
    `C ${xm} ${bot1}, ${xm} ${bot0}, ${x0} ${bot0} Z`
  );
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
  const leftGapBudget = Math.max(0, leftNodes.length - 1) * gap;
  const rightGapBudget = Math.max(0, rightNodes.length - 1) * gap;
  // Use the larger gap budget so both columns share the same pxPerUnit —
  // preserving flow conservation (left node heights sum ≈ right node heights sum).
  const maxGapBudget = Math.max(leftGapBudget, rightGapBudget);
  const pxPerUnit = (height - maxGapBudget) / grandTotal;
  // The pool's ribbon face packs contiguously (no gaps between amounts),
  // so its total span is the "flow height" — smaller than either column's
  // total stack (which does interleave gaps). Center both vertically.
  const flowHeight = grandTotal * pxPerUnit;
  const poolFlowTop = (height - flowHeight) / 2;

  const stack = (col: SankeyNode[], x: number, column: LaidOutNode['column'], gapBudget: number): LaidOutNode[] => {
    const totalStack = col.reduce((s, n) => s + Math.max(minNodeHeight, n.amount * pxPerUnit), 0) + gapBudget;
    const yStart = Math.max(0, (height - totalStack) / 2);
    const out: LaidOutNode[] = [];
    let y = yStart;
    for (const n of col) {
      const h = Math.max(minNodeHeight, n.amount * pxPerUnit);
      out.push({ ...n, column, x, y, w: nodeWidth, h });
      y += h + gap;
    }
    return out;
  };

  const left = stack(leftNodes, 0, 'left', leftGapBudget);
  const right = stack(rightNodes, width - nodeWidth, 'right', rightGapBudget);

  // Center pool: reported height stays `height` for flow-conservation semantics.
  // Rendering treats the pool as a thin spine over the flow y-range only.
  const pool: LaidOutNode = {
    key: 'pool', label: 'Revenus', amount: model.totalIncome, color: null, tone: 'category',
    column: 'center', x: (width - nodeWidth) / 2, y: 0, w: nodeWidth, h: height,
  };

  const nodes = [...left, pool, ...right];

  // Links: filled ribbons whose top/bottom curves stack contiguously on the
  // pool's edges (no gaps in the middle) — the visual expansion between the
  // spread-out column stacks and the tight pool is what makes it a Sankey.
  const links: LaidOutLink[] = [];
  let leftCursor = poolFlowTop;
  for (const n of left) {
    links.push({
      key: `${n.key}->pool`, sourceKey: n.key, targetKey: 'pool',
      path: ribbonPath(n.x + n.w, n.y, n.y + n.h, pool.x, leftCursor, leftCursor + n.h),
      width: Math.max(1, n.h), color: n.color,
    });
    leftCursor += n.h;
  }
  let rightCursor = poolFlowTop;
  for (const n of right) {
    links.push({
      key: `pool->${n.key}`, sourceKey: 'pool', targetKey: n.key,
      path: ribbonPath(pool.x + pool.w, rightCursor, rightCursor + n.h, n.x, n.y, n.y + n.h),
      width: Math.max(1, n.h), color: n.color,
    });
    rightCursor += n.h;
  }

  return { nodes, links, width, height };
}
