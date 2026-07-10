# Dashboard Sankey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cash-flow Sankey diagram to the Dashboard showing income sources → a central "Revenus" pool → expense categories (rolled up to parents) + an Épargne node, for the range-picked period.

**Architecture:** Frontend-only. A pure logic module (`sankey.ts`) builds a data model from the existing `/api/reports/categories` + `/api/categories` responses and lays it out as SVG geometry. A presentational component (`Sankey.tsx`) renders the geometry as hand-rolled inline SVG. A section wrapper (`SankeySection.tsx`) fetches, feeds, and handles loading/error/empty, and is mounted in `Dashboard/index.tsx`.

**Tech Stack:** React 18 + TypeScript, TanStack Query, Vitest + @testing-library/react, hand-rolled inline SVG (no charting library).

## Global Constraints

- No new runtime dependencies (project convention; going-public/minimal-footprint goal). Hand-rolled SVG only — no `d3-sankey`, no charting lib.
- No backend, schema, or migration changes. Reuse `/api/reports/categories` (returns `{ rows: CategoryReportRow[] }`) and `/api/categories` (returns `{ categories: Category[] }`).
- Amounts are fixed-point strings from the API; parse with `Number(...)`. Expenses are stored negative — negate to positive for display (same as the budget report).
- French UI copy, matching existing Dashboard tone. Use `formatAmount(amount, currency)` from `src/lib/format.ts`.
- Money-flow aggregates exclude internal transfers (already excluded server-side via `transfer_group_id IS NULL`; guard again client-side on `category_is_internal_transfer`).
- Test runner: `npx vitest run <path>` from the `frontend/` directory.
- Default node caps: top 6 expense parents, top 4 income sources; rest bundled into `Autres`. Defined as named constants.
- v1 excludes: tooltips/interactivity, drill-down, animation, accessible data-table fallback, per-account filtering, two-level flows. Uncategorized and neutral/transfer-kind rows are excluded from the diagram (documented limitation).

---

### Task 1: `buildSankeyModel` — pure data model

**Files:**
- Create: `frontend/src/pages/Dashboard/sankey.ts`
- Test: `frontend/src/pages/Dashboard/__tests__/sankey.test.ts`

**Interfaces:**
- Consumes: `CategoryReportRow` and `Category` from `../../../api/types` (relative to the test/module — `../../api/types` from `sankey.ts`).
- Produces:
  ```ts
  export interface SankeyNode {
    key: string;                 // stable id: `in:<rootId>`, `out:<rootId>`, `in:autres`, `out:autres`
    label: string;
    amount: number;              // always positive
    color: string | null;
    tone: 'category' | 'sage' | 'clay' | 'neutral';
  }
  export interface SankeyModel {
    incomeNodes: SankeyNode[];   // left column (excludes the deficit source)
    expenseNodes: SankeyNode[];  // right column (excludes the savings node)
    savings: number;             // > 0 only when income > expense, else 0
    deficit: number;             // > 0 only when expense > income, else 0
    totalIncome: number;
    totalExpense: number;
    currency: string;
  }
  export interface BuildOpts { topNIncome?: number; topNExpense?: number; }
  export function buildSankeyModel(
    rows: CategoryReportRow[],
    categories: Category[],
    currency: string,
    opts?: BuildOpts,
  ): SankeyModel;
  export const DEFAULT_TOP_N_INCOME = 4;
  export const DEFAULT_TOP_N_EXPENSE = 6;
  ```

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/Dashboard/__tests__/sankey.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSankeyModel } from '../sankey';
import type { Category, CategoryReportRow } from '../../../api/types';

const cat = (id: number, name: string, kind: Category['kind'], over: Partial<Category> = {}): Category => ({
  id, name, kind, color: null, parentId: null, isDefault: false, isInternalTransfer: false, ...over,
});
const row = (category_id: number | null, kind: CategoryReportRow['category_kind'], total: string): CategoryReportRow => ({
  category_id, category_name: null, category_kind: kind, category_is_internal_transfer: false,
  month: '2026-06', total, transaction_count: 1,
});

describe('buildSankeyModel', () => {
  it('splits income vs expense and negates expense totals to positive', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')];
    const rows = [row(1, 'income', '3000.00'), row(2, 'expense', '-800.00')];
    const m = buildSankeyModel(rows, cats, 'EUR');
    expect(m.totalIncome).toBe(3000);
    expect(m.totalExpense).toBe(800);
    expect(m.incomeNodes[0]).toMatchObject({ label: 'Salaire', amount: 3000 });
    expect(m.expenseNodes[0]).toMatchObject({ label: 'Courses', amount: 800 });
  });

  it('rolls leaf categories up to their root ancestor', () => {
    const cats = [cat(1, 'Maison', 'expense'), cat(2, 'Loyer', 'expense', { parentId: 1 }), cat(3, 'EDF', 'expense', { parentId: 1 })];
    const rows = [row(2, 'expense', '-500.00'), row(3, 'expense', '-100.00')];
    const m = buildSankeyModel(rows, cats, 'EUR');
    expect(m.expenseNodes).toHaveLength(1);
    expect(m.expenseNodes[0]).toMatchObject({ label: 'Maison', amount: 600 });
  });

  it('bundles categories beyond topN into an Autres node, sorted by amount', () => {
    const cats = [1, 2, 3].map((i) => cat(i, `C${i}`, 'expense'));
    const rows = [row(1, 'expense', '-300'), row(2, 'expense', '-200'), row(3, 'expense', '-50')];
    const m = buildSankeyModel(rows, cats, 'EUR', { topNExpense: 2 });
    expect(m.expenseNodes.map((n) => n.label)).toEqual(['C1', 'C2', 'Autres']);
    expect(m.expenseNodes[2]).toMatchObject({ label: 'Autres', amount: 50 });
  });

  it('computes a positive savings node and zero deficit on surplus', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')];
    const m = buildSankeyModel([row(1, 'income', '3000'), row(2, 'expense', '-800')], cats, 'EUR');
    expect(m.savings).toBe(2200);
    expect(m.deficit).toBe(0);
  });

  it('computes a positive deficit and zero savings on overspend', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')];
    const m = buildSankeyModel([row(1, 'income', '1000'), row(2, 'expense', '-1500')], cats, 'EUR');
    expect(m.deficit).toBe(500);
    expect(m.savings).toBe(0);
  });

  it('excludes internal-transfer, neutral, and uncategorized rows', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Vir', 'expense', { isInternalTransfer: true }), cat(3, 'Neutre', 'neutral')];
    const rows = [
      row(1, 'income', '1000'),
      row(2, 'expense', '-500'),
      row(3, 'neutral', '-20'),
      row(null, null, '-40'),
    ];
    const m = buildSankeyModel(rows, cats, 'EUR');
    expect(m.totalExpense).toBe(0);
    expect(m.totalIncome).toBe(1000);
  });

  it('conserves flow: left total equals right total', () => {
    const cats = [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')];
    const m = buildSankeyModel([row(1, 'income', '3000'), row(2, 'expense', '-800')], cats, 'EUR');
    const left = m.totalIncome + m.deficit;
    const right = m.totalExpense + m.savings;
    expect(left).toBe(right);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/sankey.test.ts`
Expected: FAIL — `buildSankeyModel` is not exported / module not found.

- [ ] **Step 3: Implement `buildSankeyModel`**

Create `frontend/src/pages/Dashboard/sankey.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/sankey.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/sankey.ts frontend/src/pages/Dashboard/__tests__/sankey.test.ts
git commit -m "feat(dashboard): sankey cash-flow data model"
```

---

### Task 2: `layoutSankey` — SVG geometry

**Files:**
- Modify: `frontend/src/pages/Dashboard/sankey.ts` (append)
- Test: `frontend/src/pages/Dashboard/__tests__/sankey.test.ts` (append)

**Interfaces:**
- Consumes: `SankeyModel`, `SankeyNode` from Task 1.
- Produces:
  ```ts
  export interface LaidOutNode {
    key: string; label: string; amount: number; color: string | null;
    tone: SankeyNode['tone'];
    column: 'left' | 'center' | 'right';
    x: number; y: number; w: number; h: number;
  }
  export interface LaidOutLink {
    key: string; sourceKey: string; targetKey: string;
    path: string;            // cubic-Bézier centre-to-centre "d"
    width: number;           // stroke width in px (∝ amount)
    color: string | null;
  }
  export interface SankeyLayout { nodes: LaidOutNode[]; links: LaidOutLink[]; width: number; height: number; }
  export interface LayoutOpts { width?: number; height?: number; nodeWidth?: number; gap?: number; minNodeHeight?: number; }
  export function layoutSankey(model: SankeyModel, opts?: LayoutOpts): SankeyLayout;
  ```
  The center "Revenus" pool node has key `pool`; the savings node key `out:savings`; the deficit source key `in:deficit`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/pages/Dashboard/__tests__/sankey.test.ts`:

```ts
import { layoutSankey } from '../sankey';

describe('layoutSankey', () => {
  const model = buildSankeyModel(
    [row(1, 'income', '3000'), row(2, 'expense', '-800')],
    [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')],
    'EUR',
  );

  it('places three columns and a single center pool', () => {
    const { nodes } = layoutSankey(model, { width: 600, height: 300 });
    const cols = new Set(nodes.map((n) => n.column));
    expect(cols).toEqual(new Set(['left', 'center', 'right']));
    expect(nodes.filter((n) => n.column === 'center')).toHaveLength(1);
    expect(nodes.find((n) => n.column === 'center')!.key).toBe('pool');
  });

  it('emits a savings node on the right when there is surplus', () => {
    const { nodes } = layoutSankey(model, { width: 600, height: 300 });
    expect(nodes.find((n) => n.key === 'out:savings')).toBeTruthy();
    expect(nodes.find((n) => n.key === 'in:deficit')).toBeUndefined();
  });

  it('emits a deficit source on the left when overspending', () => {
    const deficitModel = buildSankeyModel(
      [row(1, 'income', '1000'), row(2, 'expense', '-1500')],
      [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')],
      'EUR',
    );
    const { nodes } = layoutSankey(deficitModel, { width: 600, height: 300 });
    expect(nodes.find((n) => n.key === 'in:deficit')).toBeTruthy();
    expect(nodes.find((n) => n.key === 'out:savings')).toBeUndefined();
  });

  it('produces only non-negative dimensions and positive link widths', () => {
    const { nodes, links } = layoutSankey(model, { width: 600, height: 300 });
    for (const n of nodes) { expect(n.w).toBeGreaterThan(0); expect(n.h).toBeGreaterThanOrEqual(0); }
    for (const l of links) { expect(l.width).toBeGreaterThan(0); expect(l.path).toMatch(/^M/); }
  });

  it('conserves height: left node heights sum ~= right node heights sum', () => {
    const { nodes } = layoutSankey(model, { width: 600, height: 300, gap: 0, minNodeHeight: 0 });
    const sum = (col: string) => nodes.filter((n) => n.column === col).reduce((s, n) => s + n.h, 0);
    expect(Math.abs(sum('left') - sum('right'))).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/sankey.test.ts`
Expected: FAIL — `layoutSankey` is not exported.

- [ ] **Step 3: Implement `layoutSankey`**

Append to `frontend/src/pages/Dashboard/sankey.ts`:

```ts
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
  const scale = (col: SankeyNode[]) => {
    const gaps = Math.max(0, col.length - 1) * gap;
    return (height - gaps) / grandTotal;
  };

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

  const leftScale = scale(leftNodes);
  const rightScale = scale(rightNodes);
  const left = stack(leftNodes, 0, 'left', leftScale);
  const right = stack(rightNodes, width - nodeWidth, 'right', rightScale);

  // Center pool spans the full height (its amount == grandTotal).
  const pool: LaidOutNode = {
    key: 'pool', label: 'Revenus', amount: grandTotal, color: null, tone: 'category',
    column: 'center', x: (width - nodeWidth) / 2, y: 0, w: nodeWidth, h: height,
  };

  const nodes = [...left, pool, right];

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/sankey.test.ts`
Expected: PASS (12 tests total).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/sankey.ts frontend/src/pages/Dashboard/__tests__/sankey.test.ts
git commit -m "feat(dashboard): sankey svg layout geometry"
```

---

### Task 3: `Sankey` presentational component

**Files:**
- Create: `frontend/src/components/Sankey.tsx`
- Test: `frontend/src/components/__tests__/Sankey.test.tsx`

**Interfaces:**
- Consumes: `SankeyModel`, `layoutSankey` from `../pages/Dashboard/sankey`; `formatAmount` from `../lib/format`.
- Produces: `export function Sankey({ model }: { model: SankeyModel }): JSX.Element`.

Tone → CSS class mapping (Tailwind tokens already used elsewhere): `sage` → `text-sage-300` + `fill-sage-500`, `clay` → `text-clay-300` + `fill-clay-500`, `neutral`/`category` fall back to `ink` tokens / the category color. Ribbons use the source node color (or `currentColor`) at reduced opacity.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/__tests__/Sankey.test.tsx`:

```tsx
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sankey } from '../Sankey';
import { buildSankeyModel } from '../../pages/Dashboard/sankey';
import type { Category, CategoryReportRow } from '../../api/types';

const cat = (id: number, name: string, kind: Category['kind']): Category => ({
  id, name, kind, color: null, parentId: null, isDefault: false, isInternalTransfer: false,
});
const row = (id: number, kind: CategoryReportRow['category_kind'], total: string): CategoryReportRow => ({
  category_id: id, category_name: null, category_kind: kind, category_is_internal_transfer: false,
  month: '2026-06', total, transaction_count: 1,
});

it('renders node labels including the Revenus pool and Épargne', () => {
  const model = buildSankeyModel(
    [row(1, 'income', '3000'), row(2, 'expense', '-800')],
    [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')],
    'EUR',
  );
  render(<Sankey model={model} />);
  expect(screen.getByText('Salaire')).toBeInTheDocument();
  expect(screen.getByText('Courses')).toBeInTheDocument();
  expect(screen.getByText('Revenus')).toBeInTheDocument();
  expect(screen.getByText('Épargne')).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('aria-label');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/Sankey.test.tsx`
Expected: FAIL — cannot resolve `../Sankey`.

- [ ] **Step 3: Implement `Sankey.tsx`**

Create `frontend/src/components/Sankey.tsx`:

```tsx
import { useMemo } from 'react';
import { layoutSankey, type SankeyModel, type LaidOutNode } from '../pages/Dashboard/sankey';
import { formatAmount } from '../lib/format';

const VIEW_W = 720;
const VIEW_H = 360;

function nodeFill(n: LaidOutNode): string {
  if (n.tone === 'sage') return 'rgb(var(--sage-500, 132 169 140) / 1)';
  if (n.tone === 'clay') return 'rgb(var(--clay-500, 193 118 96) / 1)';
  if (n.color) return n.color;
  return 'rgb(148 163 184 / 1)'; // ink fallback
}

export function Sankey({ model }: { model: SankeyModel }): JSX.Element {
  const layout = useMemo(
    () => layoutSankey(model, { width: VIEW_W, height: VIEW_H }),
    [model],
  );

  const ariaLabel =
    `Flux : ${formatAmount(model.totalIncome, model.currency)} de revenus, ` +
    `${formatAmount(model.totalExpense, model.currency)} de dépenses`;

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H + 40}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full min-w-[520px]"
      >
        {/* ribbons first so nodes/labels sit on top */}
        <g fill="none">
          {layout.links.map((l) => (
            <path
              key={l.key}
              d={l.path}
              stroke={l.color ?? 'rgb(148 163 184 / 1)'}
              strokeWidth={l.width}
              strokeOpacity={0.28}
            />
          ))}
        </g>
        <g>
          {layout.nodes.map((n) => (
            <g key={n.key}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={2} fill={nodeFill(n)} />
              <text
                x={n.column === 'right' ? n.x - 6 : n.x + n.w + 6}
                y={n.y + n.h / 2}
                textAnchor={n.column === 'right' ? 'end' : 'start'}
                dominantBaseline="middle"
                className="fill-ink-200 text-[11px] tabular-nums"
              >
                {n.label} · {formatAmount(n.amount, model.currency)}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
```

Note: `viewBox` height adds 40px of vertical breathing room for edge labels. The `rgb(var(--...))` fallbacks degrade to literal ink/sage/clay values if the CSS var is absent; if the project exposes sage/clay differently, match `CategoryDonut`'s color approach instead — check it during implementation.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/Sankey.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sankey.tsx frontend/src/components/__tests__/Sankey.test.tsx
git commit -m "feat(dashboard): sankey presentational svg component"
```

---

### Task 4: `SankeySection` + Dashboard wiring

**Files:**
- Create: `frontend/src/pages/Dashboard/SankeySection.tsx`
- Test: `frontend/src/pages/Dashboard/__tests__/SankeySection.test.tsx`
- Modify: `frontend/src/pages/Dashboard/index.tsx`

**Interfaces:**
- Consumes: `buildSankeyModel` (Task 1), `Sankey` (Task 3), `fromDateFor` + `RangeKey` from `../../components/RangePicker`, `api` from `../../api/client`, `Category` + `CategoryReportRow` from `../../api/types`.
- Produces: `export function SankeySection({ range, currency }: { range: RangeKey; currency: string }): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Dashboard/__tests__/SankeySection.test.tsx`:

```tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SankeySection } from '../SankeySection';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});
import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SankeySection range="12m" currency="EUR" />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiMock.mockReset());

it('renders the flow once data arrives', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') {
      return { categories: [
        { id: 1, name: 'Salaire', kind: 'income', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
        { id: 2, name: 'Courses', kind: 'expense', color: null, parentId: null, isDefault: false, isInternalTransfer: false },
      ] } as any;
    }
    return { rows: [
      { category_id: 1, category_name: 'Salaire', category_kind: 'income', category_is_internal_transfer: false, month: '2026-06', total: '3000', transaction_count: 1 },
      { category_id: 2, category_name: 'Courses', category_kind: 'expense', category_is_internal_transfer: false, month: '2026-06', total: '-800', transaction_count: 1 },
    ] } as any;
  });
  renderSection();
  await waitFor(() => expect(screen.getByText('Revenus')).toBeInTheDocument());
  expect(screen.getByText('Salaire')).toBeInTheDocument();
});

it('shows an empty state when there is no income', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection();
  await waitFor(() => expect(screen.getByText(/Pas de revenus/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/SankeySection.test.tsx`
Expected: FAIL — cannot resolve `../SankeySection`.

- [ ] **Step 3: Implement `SankeySection.tsx`**

Create `frontend/src/pages/Dashboard/SankeySection.tsx`:

```tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Category, CategoryReportRow } from '../../api/types';
import { fromDateFor, type RangeKey } from '../../components/RangePicker';
import { buildSankeyModel } from './sankey';
import { Sankey } from '../../components/Sankey';

interface Props { range: RangeKey; currency: string; }

export function SankeySection({ range, currency }: Props): JSX.Element {
  const fromDate = fromDateFor(range);

  const catListQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });
  const reportQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: fromDate ? { fromDate } : {},
      }),
  });

  const model = useMemo(
    () => buildSankeyModel(reportQ.data?.rows ?? [], catListQ.data?.categories ?? [], currency),
    [reportQ.data, catListQ.data, currency],
  );

  const isLoading = catListQ.isLoading || reportQ.isLoading;
  const isError = catListQ.isError || reportQ.isError;

  return (
    <section className="surface p-5 md:p-6">
      <div className="section-rule mb-4">Flux · {currency}</div>
      {isLoading ? (
        <div className="h-40 animate-pulse rounded-lg bg-ink-900" />
      ) : isError ? (
        <div className="text-sm text-clay-300">Erreur de chargement du flux.</div>
      ) : model.totalIncome <= 0 ? (
        <div className="text-sm text-ink-400 display-italic">Pas de revenus sur la période.</div>
      ) : (
        <Sankey model={model} />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/SankeySection.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into the Dashboard**

In `frontend/src/pages/Dashboard/index.tsx`, add the import near the other Dashboard-section imports (after line 13, `import { InsightsSection } ...`):

```tsx
import { SankeySection } from './SankeySection';
```

Then add the section immediately after the "Category breakdown — donut" `</section>` block (after line 163, before the closing `</div>` at line 165):

```tsx
      {/* Cash-flow Sankey — follows the page range */}
      {currencies.length > 0 && (
        <SankeySection range={range} currency={chartCurrency} />
      )}
```

- [ ] **Step 6: Run the full Dashboard test suite to check nothing regressed**

Run: `cd frontend && npx vitest run src/pages/Dashboard src/pages/__tests__/Dashboard.test.tsx src/components/__tests__/Sankey.test.tsx`
Expected: PASS across sankey model, layout, component, section, and existing Dashboard tests.

- [ ] **Step 7: Typecheck + build**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Dashboard/SankeySection.tsx frontend/src/pages/Dashboard/__tests__/SankeySection.test.tsx frontend/src/pages/Dashboard/index.tsx
git commit -m "feat(dashboard): mount cash-flow Sankey section"
```

---

## Manual verification

After Task 4, run the app and confirm on the Dashboard:
- The "Flux · EUR" section appears below "Répartition par catégorie".
- Changing the range picker updates the diagram.
- Income sources flow left → "Revenus" pool → expense parents; a surplus shows an "Épargne" node on the right; forcing overspend shows "Épargne puisée" on the left.
- On a narrow window the SVG scrolls horizontally rather than breaking the layout.
</content>
