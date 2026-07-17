import type { Category, CategoryReportRow } from '../../api/types';

export interface BreakdownItem {
  label: string;
  amount: number;
  color: string | null;
}
export interface SankeyNode {
  key: string;
  label: string;
  amount: number;
  color: string | null;
  tone: 'category' | 'sage' | 'clay' | 'neutral';
  // Only set on the aggregated "Autres" tail node — lists the individual
  // category groups it bundles, sorted by descending amount. Consumers
  // (e.g. hover tooltip) can reveal the detail without recomputing.
  breakdown?: BreakdownItem[];
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
export interface BuildOpts {
  topNIncome?: number;
  topNExpense?: number;
  /** Label for the aggregated tail node beyond topN. Defaults to the
      French 'Autres' for backward compatibility with existing callers/tests
      that don't pass a translated override; production call sites (e.g.
      SankeySection.tsx) pass the 'charts' namespace's translated string. */
  otherLabel?: string;
}

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
  otherLabel: string,
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
      key: `${keyPrefix}:autres`, label: otherLabel,
      amount: tail.reduce((s, g) => s + g.amount, 0), color: null, tone: 'neutral',
      breakdown: tail.map((g) => ({ label: g.label, amount: g.amount, color: g.color })),
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

  const otherLabel = opts.otherLabel ?? 'Autres';
  const incomeNodes = bucketToNodes(income, topNIncome, 'in', otherLabel);
  const expenseNodes = bucketToNodes(expense, topNExpense, 'out', otherLabel);
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

export interface LaidOutNode extends SankeyNode {
  column: 'left' | 'center' | 'right';
  x: number; y: number; w: number; h: number;
}
export interface LaidOutLink {
  key: string; sourceKey: string; targetKey: string;
  path: string; width: number; color: string | null;
}
export interface SankeyLayout { nodes: LaidOutNode[]; links: LaidOutLink[]; width: number; height: number; }
export interface LayoutOpts {
  width?: number;
  height?: number;
  nodeWidth?: number;
  gap?: number;
  minNodeHeight?: number;
  /** Labels for the synthetic pool/savings nodes. Default to the French
      copy for backward compatibility with existing callers/tests; the
      Sankey component passes the 'charts' namespace's translated strings. */
  poolLabel?: string;
  savingsLabel?: string;
  savingsWithdrawnLabel?: string;
}

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
  const requestedHeight = opts.height ?? 320;
  const nodeWidth = opts.nodeWidth ?? 14;
  const gap = opts.gap ?? 6;
  // Room for the two-line label (name + amount) rendered inside each node.
  // The two 11-px text lines centred symmetrically around the node midline
  // span 26 px; 28 px gives 1 px of slack top and bottom so the amount
  // never bleeds outside the coloured ribbon.
  const minNodeHeight = opts.minNodeHeight ?? 28;
  const poolLabel = opts.poolLabel ?? 'Revenus';
  const savingsLabel = opts.savingsLabel ?? 'Épargne';
  const savingsWithdrawnLabel = opts.savingsWithdrawnLabel ?? 'Épargne puisée';

  // Left = income sources (+ deficit source); right = expenses (+ savings).
  const leftNodes: SankeyNode[] = [...model.incomeNodes];
  if (model.deficit > 0) {
    leftNodes.push({ key: 'in:deficit', label: savingsWithdrawnLabel, amount: model.deficit, color: null, tone: 'clay' });
  }
  const rightNodes: SankeyNode[] = [...model.expenseNodes];
  if (model.savings > 0) {
    rightNodes.push({ key: 'out:savings', label: savingsLabel, amount: model.savings, color: null, tone: 'sage' });
  }

  const grandTotal = leftNodes.reduce((s, n) => s + n.amount, 0) || 1;
  const leftGapBudget = Math.max(0, leftNodes.length - 1) * gap;
  const rightGapBudget = Math.max(0, rightNodes.length - 1) * gap;
  const maxGapBudget = Math.max(leftGapBudget, rightGapBudget);
  // Scale factor: how many px per unit of amount at the requested height,
  // before any min-floor bumps. Large nodes stay proportional; small nodes
  // may get bumped to `minNodeHeight`, and the layout grows to fit.
  const pxPerUnit = (requestedHeight - maxGapBudget) / grandTotal;

  const heightsFor = (nodes: SankeyNode[]) =>
    nodes.map((n) => Math.max(minNodeHeight, n.amount * pxPerUnit));

  const leftHeights = heightsFor(leftNodes);
  const rightHeights = heightsFor(rightNodes);
  const leftStackH = leftHeights.reduce((s, h) => s + h, 0);
  const rightStackH = rightHeights.reduce((s, h) => s + h, 0);
  const requiredHeight = Math.max(leftStackH + leftGapBudget, rightStackH + rightGapBudget);
  // Grow the canvas if the min-floor bumps pushed a column past the
  // requested height — the SVG viewBox tracks this so the chart just
  // becomes a bit taller instead of the labels overlapping again.
  const height = Math.max(requestedHeight, requiredHeight);

  const stack = (col: SankeyNode[], heights: number[], x: number, column: LaidOutNode['column'], gapBudget: number): LaidOutNode[] => {
    const totalStack = heights.reduce((s, h) => s + h, 0) + gapBudget;
    const yStart = Math.max(0, (height - totalStack) / 2);
    const out: LaidOutNode[] = [];
    let y = yStart;
    for (let i = 0; i < col.length; i++) {
      const n = col[i]!;
      const h = heights[i]!;
      out.push({ ...n, column, x, y, w: nodeWidth, h });
      y += h + gap;
    }
    return out;
  };

  const left = stack(leftNodes, leftHeights, 0, 'left', leftGapBudget);
  const right = stack(rightNodes, rightHeights, width - nodeWidth, 'right', rightGapBudget);

  // Ribbons pack contiguously on the pool (no per-node gaps on that face),
  // so each side has its own flow-face height. Center each side's ribbon
  // stack vertically — if left and right totals differ (min-floor asymmetry),
  // the spine ends up spanning the union of the two ranges (see Sankey.tsx).
  const leftPoolFlowTop = (height - leftStackH) / 2;
  const rightPoolFlowTop = (height - rightStackH) / 2;

  const pool: LaidOutNode = {
    key: 'pool', label: poolLabel, amount: model.totalIncome, color: null, tone: 'category',
    column: 'center', x: (width - nodeWidth) / 2, y: 0, w: nodeWidth, h: height,
  };

  const nodes = [...left, pool, ...right];

  const links: LaidOutLink[] = [];
  let leftCursor = leftPoolFlowTop;
  for (const n of left) {
    links.push({
      key: `${n.key}->pool`, sourceKey: n.key, targetKey: 'pool',
      path: ribbonPath(n.x + n.w, n.y, n.y + n.h, pool.x, leftCursor, leftCursor + n.h),
      width: Math.max(1, n.h), color: n.color,
    });
    leftCursor += n.h;
  }
  let rightCursor = rightPoolFlowTop;
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
