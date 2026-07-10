# Comparatif mensuel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dashboard "Comparatif mensuel" section comparing each category's current-month total against the previous month, with delta and a 6-month sparkline.

**Architecture:** Pure aggregation helpers turn the existing `/api/reports/categories` per-month rows into comparison rows; a presentational `Sparkline` renders the trend; a `ComparatifMensuelSection` wires query + toggle + rows into the Dashboard. No backend change.

**Tech Stack:** React 18 + TypeScript, @tanstack/react-query, Vitest + @testing-library/react, Tailwind (project design tokens).

## Global Constraints

- No backend / API changes; consume `GET /api/reports/categories` only.
- `row.month` from the endpoint is the string `"YYYY-MM"` (from `to_char(date_trunc('month', …), 'YYYY-MM')`). Month matching MUST use this format.
- Amounts are signed strings: expenses negative, income positive.
- Skip rows where `category_is_internal_transfer` is true (matches `MoyennesMensuellesSection`).
- Favorable delta → `text-sage-300`; unfavorable → `text-clay-300`; neutral → `text-ink-400`. For **expenses** favorable = spent less (deltaAbs < 0); for **income** favorable = earned more (deltaAbs > 0).
- Date math uses UTC (`Date.UTC`, `getUTC*`), matching existing `Dashboard/helpers.ts`.
- Tests are co-located under `frontend/src/pages/Dashboard/__tests__/` and `frontend/src/components/__tests__/` (or alongside — follow the nearest existing sibling).
- French UI copy, lower-case month names, matching existing tone.
- Run frontend tests with: `cd frontend && npx vitest run <path>`.

---

### Task 1: Aggregation + window helpers

**Files:**
- Modify: `frontend/src/pages/Dashboard/helpers.ts`
- Test: `frontend/src/pages/Dashboard/__tests__/helpers.test.ts` (create)

**Interfaces:**
- Consumes: `CategoryReportRow` from `frontend/src/api/types.ts`.
- Produces:
  - `type ComparatifMode = 'expense' | 'income'`
  - `interface ComparatifRow { id: number | null; name: string; color: string | null; current: number; previous: number; deltaAbs: number; deltaPct: number | null; spark: number[] }`
  - `currentMonthKey(now?: Date): string` → `"YYYY-MM"`
  - `recentMonthKeys(count: number, now?: Date): string[]` → chronological `"YYYY-MM"` list ending at the current month
  - `buildComparison(rows: CategoryReportRow[], mode: ComparatifMode, currentMonth: string, months: string[]): ComparatifRow[]`
  - `deltaTone(mode: ComparatifMode, deltaAbs: number): 'sage' | 'clay' | 'neutral'`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/Dashboard/__tests__/helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  currentMonthKey,
  recentMonthKeys,
  buildComparison,
  deltaTone,
  type ComparatifRow,
} from '../helpers';
import type { CategoryReportRow } from '../../../api/types';

// Minimal row factory — only the fields buildComparison reads.
function row(partial: Partial<CategoryReportRow>): CategoryReportRow {
  return {
    category_id: null,
    category_name: null,
    category_kind: null,
    category_is_internal_transfer: false,
    month: '2026-07',
    total: '0',
    transaction_count: 0,
    ...partial,
  };
}

const MONTHS = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const CURRENT = '2026-07';

describe('currentMonthKey / recentMonthKeys', () => {
  it('formats the current month as YYYY-MM (UTC)', () => {
    expect(currentMonthKey(new Date(Date.UTC(2026, 6, 15)))).toBe('2026-07');
  });

  it('returns `count` chronological month keys ending at the current month', () => {
    expect(recentMonthKeys(6, new Date(Date.UTC(2026, 6, 15)))).toEqual(MONTHS);
  });

  it('crosses a year boundary correctly', () => {
    expect(recentMonthKeys(3, new Date(Date.UTC(2026, 0, 10)))).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });
});

describe('buildComparison', () => {
  it('filters by sign for expense mode and computes current/previous/delta', () => {
    const rows = [
      row({ category_id: 1, category_name: 'Courses', month: '2026-06', total: '-100.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-07', total: '-150.00' }),
      row({ category_id: 2, category_name: 'Salaire', month: '2026-07', total: '2000.00' }), // income, dropped
    ];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 1,
      name: 'Courses',
      current: 150,
      previous: 100,
      deltaAbs: 50,
    });
    expect(out[0].deltaPct).toBeCloseTo(50);
  });

  it('keeps only positive rows in income mode', () => {
    const rows = [
      row({ category_id: 2, category_name: 'Salaire', month: '2026-07', total: '2000.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-07', total: '-150.00' }),
    ];
    const out = buildComparison(rows, 'income', CURRENT, MONTHS);
    expect(out.map((r) => r.name)).toEqual(['Salaire']);
  });

  it('skips internal-transfer categories', () => {
    const rows = [
      row({ category_id: 3, category_name: 'Épargne', month: '2026-07', total: '-500.00', category_is_internal_transfer: true }),
    ];
    expect(buildComparison(rows, 'expense', CURRENT, MONTHS)).toHaveLength(0);
  });

  it('returns null deltaPct when previous is zero (new category)', () => {
    const rows = [row({ category_id: 4, category_name: 'Vacances', month: '2026-07', total: '-300.00' })];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out[0]).toMatchObject({ current: 300, previous: 0, deltaAbs: 300, deltaPct: null });
  });

  it('reports -100% for a category that stopped this month', () => {
    const rows = [row({ category_id: 5, category_name: 'Essence', month: '2026-06', total: '-80.00' })];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out[0]).toMatchObject({ current: 0, previous: 80, deltaAbs: -80 });
    expect(out[0].deltaPct).toBeCloseTo(-100);
  });

  it('builds a 6-element chronological sparkline with zero-filled gaps', () => {
    const rows = [
      row({ category_id: 1, category_name: 'Courses', month: '2026-04', total: '-40.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-07', total: '-90.00' }),
    ];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out[0].spark).toEqual([0, 0, 40, 0, 0, 90]);
  });

  it('sorts by current desc, then previous desc, then name asc', () => {
    const rows = [
      row({ category_id: 1, category_name: 'B', month: '2026-07', total: '-50.00' }),
      row({ category_id: 2, category_name: 'A', month: '2026-07', total: '-200.00' }),
      row({ category_id: 3, category_name: 'C', month: '2026-06', total: '-70.00' }), // current 0
    ];
    const out = buildComparison(rows, 'expense', CURRENT, MONTHS);
    expect(out.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });

  it('labels null category id as "Sans catégorie"', () => {
    const rows = [row({ category_id: null, month: '2026-07', total: '-10.00' })];
    expect(buildComparison(rows, 'expense', CURRENT, MONTHS)[0].name).toBe('Sans catégorie');
  });
});

describe('deltaTone', () => {
  it('expense: spending less is favorable (sage), more is unfavorable (clay)', () => {
    expect(deltaTone('expense', -10)).toBe('sage');
    expect(deltaTone('expense', 10)).toBe('clay');
  });
  it('income: earning more is favorable (sage), less is unfavorable (clay)', () => {
    expect(deltaTone('income', 10)).toBe('sage');
    expect(deltaTone('income', -10)).toBe('clay');
  });
  it('zero delta is neutral', () => {
    expect(deltaTone('expense', 0)).toBe('neutral');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/helpers.test.ts`
Expected: FAIL — `buildComparison`, `recentMonthKeys`, `currentMonthKey`, `deltaTone` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `frontend/src/pages/Dashboard/helpers.ts`:

```ts
import type { CategoryReportRow } from '../../api/types';

export type ComparatifMode = 'expense' | 'income';

export interface ComparatifRow {
  id: number | null;
  name: string;
  color: string | null;
  current: number;
  previous: number;
  deltaAbs: number;
  deltaPct: number | null;
  spark: number[];
}

// Current month as "YYYY-MM" (UTC), matching the report's date_trunc.
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// `count` month keys, chronological, ending at the current month.
export function recentMonthKeys(count: number, now: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

// Which delta direction is "good" depends on the mode; expenses invert.
export function deltaTone(mode: ComparatifMode, deltaAbs: number): 'sage' | 'clay' | 'neutral' {
  if (deltaAbs === 0) return 'neutral';
  const favorable = mode === 'expense' ? deltaAbs < 0 : deltaAbs > 0;
  return favorable ? 'sage' : 'clay';
}

// Aggregate per-(category, month) rows into per-category comparison rows.
// `currentMonth` and `months` are injected so this stays clock-independent.
export function buildComparison(
  rows: CategoryReportRow[],
  mode: ComparatifMode,
  currentMonth: string,
  months: string[],
): ComparatifRow[] {
  const monthIndex = new Map(months.map((m, i) => [m, i] as const));
  const previousMonth = months[months.indexOf(currentMonth) - 1] ?? null;

  interface Acc {
    id: number | null;
    name: string;
    color: string | null;
    spark: number[];
  }
  const byCat = new Map<number | null, Acc>();

  for (const r of rows) {
    if (r.category_is_internal_transfer) continue;
    const amt = Number(r.total);
    if (!Number.isFinite(amt) || amt === 0) continue;
    if (mode === 'expense' && amt >= 0) continue;
    if (mode === 'income' && amt <= 0) continue;

    let acc = byCat.get(r.category_id);
    if (!acc) {
      acc = {
        id: r.category_id,
        name: r.category_name ?? 'Sans catégorie',
        color: null,
        spark: new Array(months.length).fill(0),
      };
      byCat.set(r.category_id, acc);
    }
    const idx = monthIndex.get(r.month);
    if (idx !== undefined) acc.spark[idx] += Math.abs(amt);
  }

  const out: ComparatifRow[] = [];
  for (const acc of byCat.values()) {
    const current = acc.spark[monthIndex.get(currentMonth) ?? -1] ?? 0;
    const previous = previousMonth === null ? 0 : acc.spark[monthIndex.get(previousMonth)!] ?? 0;
    const deltaAbs = current - previous;
    out.push({
      id: acc.id,
      name: acc.name,
      color: acc.color,
      current,
      previous,
      deltaAbs,
      deltaPct: previous === 0 ? null : (deltaAbs / previous) * 100,
      spark: acc.spark,
    });
  }

  out.sort(
    (a, b) => b.current - a.current || b.previous - a.previous || a.name.localeCompare(b.name),
  );
  return out;
}
```

Note: `color` is left `null` in the helper (the report rows carry no color). The section fills it from the `/api/categories` query, exactly as `CategoryBreakdown` does. Tests assert on `color` only where they set it, which they don't — so `null` is expected.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/helpers.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/helpers.ts frontend/src/pages/Dashboard/__tests__/helpers.test.ts
git commit -m "feat(dashboard): comparison aggregation + month-window helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Sparkline component

**Files:**
- Create: `frontend/src/components/Sparkline.tsx`
- Test: `frontend/src/components/__tests__/Sparkline.test.tsx` (create)

**Interfaces:**
- Produces: `Sparkline` React component with props
  `{ values: number[]; color?: string | null; width?: number; height?: number; 'aria-label'?: string }`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/__tests__/Sparkline.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '../Sparkline';

describe('Sparkline', () => {
  it('renders a polyline with one point per value', () => {
    const { container } = render(<Sparkline values={[1, 5, 2, 8]} />);
    const poly = container.querySelector('polyline');
    expect(poly).not.toBeNull();
    // 4 points → 4 "x,y" pairs
    expect(poly!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(4);
  });

  it('renders a flat horizontal line when all values are equal', () => {
    const { container } = render(<Sparkline values={[3, 3, 3]} height={20} />);
    const poly = container.querySelector('polyline')!;
    const ys = poly
      .getAttribute('points')!
      .trim()
      .split(/\s+/)
      .map((p) => Number(p.split(',')[1]));
    // all y equal and centered (~height/2)
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBeCloseTo(10, 0);
  });

  it('renders a single dot for a one-element series', () => {
    const { container } = render(<Sparkline values={[42]} />);
    expect(container.querySelector('circle')).not.toBeNull();
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('renders nothing meaningful for an empty series but does not crash', () => {
    const { container } = render(<Sparkline values={[]} />);
    expect(container.querySelector('polyline')).toBeNull();
    expect(container.querySelector('circle')).toBeNull();
  });

  it('exposes an accessible label when provided', () => {
    const { getByLabelText } = render(<Sparkline values={[1, 2]} aria-label="tendance" />);
    expect(getByLabelText('tendance')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/__tests__/Sparkline.test.tsx`
Expected: FAIL — cannot resolve `../Sparkline`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/Sparkline.tsx`:

```tsx
interface SparklineProps {
  values: number[];
  color?: string | null;
  width?: number;
  height?: number;
  'aria-label'?: string;
}

const PAD = 2;

// Tiny inline-SVG trend line. Presentational only — no data logic, no state.
// Scales values into the box: max → top, min → bottom, flat series → centered.
export function Sparkline({
  values,
  color,
  width = 72,
  height = 20,
  'aria-label': ariaLabel,
}: SparklineProps): JSX.Element {
  const stroke = color ?? 'currentColor';
  const labelProps = ariaLabel
    ? { role: 'img', 'aria-label': ariaLabel }
    : { 'aria-hidden': true };

  const n = values.length;
  const svgProps = {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    className: color ? '' : 'text-ink-500',
    ...labelProps,
  };

  if (n === 0) {
    return <svg {...svgProps} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  const y = (v: number) =>
    flat ? height / 2 : height - PAD - ((v - min) / (max - min)) * (height - 2 * PAD);
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);

  if (n === 1) {
    return (
      <svg {...svgProps}>
        <circle cx={x(0)} cy={y(values[0])} r={2} fill={stroke} />
      </svg>
    );
  }

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg {...svgProps}>
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/__tests__/Sparkline.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sparkline.tsx frontend/src/components/__tests__/Sparkline.test.tsx
git commit -m "feat(components): presentational Sparkline (inline SVG)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ComparatifMensuelSection component

**Files:**
- Create: `frontend/src/pages/Dashboard/ComparatifMensuelSection.tsx`
- Test: `frontend/src/pages/Dashboard/__tests__/ComparatifMensuelSection.test.tsx` (create)

**Interfaces:**
- Consumes: `buildComparison`, `recentMonthKeys`, `currentMonthKey`, `deltaTone`, `ComparatifMode` (Task 1); `Sparkline` (Task 2); `api` from `../../api/client`; `formatAmount` from `../../lib/format`; `Category`, `CategoryReportRow` from `../../api/types`.
- Produces: `ComparatifMensuelSection` component with props `{ currency: string; accountId?: number | 'all' }`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pages/Dashboard/__tests__/ComparatifMensuelSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ComparatifMensuelSection } from '../ComparatifMensuelSection';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});

import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

// The section fetches BOTH /api/reports/categories and /api/categories.
// Route the mock by URL so both queries resolve.
function mockApi(rows: unknown[], categories: unknown[] = []) {
  apiMock.mockImplementation((url: string) => {
    if (url === '/api/reports/categories') return Promise.resolve({ rows });
    if (url === '/api/categories') return Promise.resolve({ categories });
    return Promise.resolve({});
  });
}

function renderSection(currency = 'EUR') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ComparatifMensuelSection currency={currency} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2026, 6, 15))); // 2026-07-15
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ComparatifMensuelSection', () => {
  it('shows the empty state when there are no rows', async () => {
    mockApi([]);
    renderSection();
    expect(await screen.findByText(/pas encore d'historique/i)).toBeInTheDocument();
  });

  it('renders the header with a "mois en cours" indicator', async () => {
    mockApi([
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-06', total: '-100.00' },
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-07', total: '-150.00' },
    ]);
    renderSection();
    expect(await screen.findByText(/Comparatif mensuel/i)).toBeInTheDocument();
    expect(screen.getByText(/mois en cours/i)).toBeInTheDocument();
  });

  it('renders a category row with current, previous, and delta', async () => {
    mockApi([
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-06', total: '-100.00' },
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-07', total: '-150.00' },
    ]);
    renderSection();
    expect(await screen.findByText('Courses')).toBeInTheDocument();
    // current 150, previous 100, delta +50 (+50,0 %)
    expect(screen.getByText(/150/)).toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument();
    expect(screen.getByText(/50,0\s*%/)).toBeInTheDocument();
  });

  it('toggles between Dépenses and Revenus', async () => {
    mockApi([
      { category_id: 1, category_name: 'Courses', category_is_internal_transfer: false, month: '2026-07', total: '-150.00' },
      { category_id: 2, category_name: 'Salaire', category_is_internal_transfer: false, month: '2026-07', total: '2000.00' },
    ]);
    renderSection();
    // Default: expenses → Courses visible, Salaire not.
    expect(await screen.findByText('Courses')).toBeInTheDocument();
    expect(screen.queryByText('Salaire')).not.toBeInTheDocument();
    // Switch to Revenus.
    fireEvent.click(screen.getByRole('button', { name: 'Revenus' }));
    expect(await screen.findByText('Salaire')).toBeInTheDocument();
    expect(screen.queryByText('Courses')).not.toBeInTheDocument();
  });

  it('shows "nouveau" for a category with no previous-month spend', async () => {
    mockApi([
      { category_id: 4, category_name: 'Vacances', category_is_internal_transfer: false, month: '2026-07', total: '-300.00' },
    ]);
    renderSection();
    expect(await screen.findByText(/nouveau/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/ComparatifMensuelSection.test.tsx`
Expected: FAIL — cannot resolve `../ComparatifMensuelSection`.

- [ ] **Step 3: Implement the component**

Create `frontend/src/pages/Dashboard/ComparatifMensuelSection.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Category, CategoryReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';
import { Sparkline } from '../../components/Sparkline';
import {
  buildComparison,
  recentMonthKeys,
  currentMonthKey,
  deltaTone,
  type ComparatifMode,
} from './helpers';

const WINDOW_MONTHS = 6;

// French lower-case month names for the header, indexed 0..11.
const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

function monthLabel(key: string): string {
  const [, m] = key.split('-');
  return MONTH_NAMES[Number(m) - 1] ?? key;
}

const TONE_CLASS: Record<'sage' | 'clay' | 'neutral', string> = {
  sage: 'text-sage-300',
  clay: 'text-clay-300',
  neutral: 'text-ink-400',
};

function formatDeltaAmount(deltaAbs: number, currency: string): string {
  const sign = deltaAbs > 0 ? '+' : '';
  return `${sign}${formatAmount(deltaAbs, currency)}`;
}

function formatPct(deltaPct: number | null): string {
  if (deltaPct === null) return 'nouveau';
  const sign = deltaPct > 0 ? '+' : '';
  return `${sign}${deltaPct.toFixed(1).replace('.', ',')} %`;
}

interface Props {
  currency: string;
  accountId?: number | 'all';
}

export function ComparatifMensuelSection({ currency, accountId }: Props): JSX.Element | null {
  const [mode, setMode] = useState<ComparatifMode>('expense');
  const scopedAccountId = typeof accountId === 'number' ? accountId : undefined;

  const months = useMemo(() => recentMonthKeys(WINDOW_MONTHS), []);
  const currentMonth = useMemo(() => currentMonthKey(), []);
  const fromDate = `${months[0]}-01`;

  const reportQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate, accountId: scopedAccountId ?? 'all' }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: {
          fromDate,
          ...(scopedAccountId ? { accountId: scopedAccountId } : {}),
        },
      }),
  });
  const categoriesQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });

  const rows = useMemo(() => {
    const built = buildComparison(reportQ.data?.rows ?? [], mode, currentMonth, months);
    const byId = new Map((categoriesQ.data?.categories ?? []).map((c) => [c.id, c] as const));
    // Fill category colors from /api/categories (report rows carry none).
    return built.map((r) => ({
      ...r,
      color: r.id !== null ? byId.get(r.id)?.color ?? null : null,
    }));
  }, [reportQ.data, categoriesQ.data, mode, currentMonth, months]);

  if (reportQ.isLoading) {
    return (
      <section>
        <div className="section-rule mb-4">Comparatif mensuel</div>
        <div className="h-40 animate-pulse rounded-lg bg-ink-900" />
      </section>
    );
  }

  const prevMonth = months[months.indexOf(currentMonth) - 1] ?? months[months.length - 2];

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="section-rule">
          Comparatif mensuel{' '}
          <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
            — {monthLabel(currentMonth)} vs {monthLabel(prevMonth)} · mois en cours
          </span>
        </div>
        <div className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
          <button
            onClick={() => setMode('expense')}
            className={`px-3 py-1.5 rounded-md transition ${
              mode === 'expense' ? 'bg-ink-850 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            Dépenses
          </button>
          <button
            onClick={() => setMode('income')}
            className={`px-3 py-1.5 rounded-md transition ${
              mode === 'income' ? 'bg-ink-850 text-ink-100' : 'text-ink-400 hover:text-ink-100'
            }`}
          >
            Revenus
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="surface p-5 text-sm text-ink-400 display-italic">
          Pas encore d'historique pour cette période.
        </div>
      ) : (
        <div className="surface divide-y divide-ink-850">
          {rows.map((r) => {
            const tone = TONE_CLASS[deltaTone(mode, r.deltaAbs)];
            return (
              <div
                key={r.id ?? 'uncat'}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[1.4fr_repeat(3,1fr)_auto]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: r.color ?? '#6b7280' }}
                  />
                  <span className="truncate text-ink-100">{r.name}</span>
                </div>
                <div className="text-right tabular-nums text-ink-100">
                  {formatAmount(r.current, currency)}
                </div>
                <div className="hidden text-right tabular-nums text-ink-400 sm:block">
                  {formatAmount(r.previous, currency)}
                </div>
                <div className={`text-right tabular-nums ${tone}`}>
                  <div>{formatDeltaAmount(r.deltaAbs, currency)}</div>
                  <div className="text-xs">{formatPct(r.deltaPct)}</div>
                </div>
                <div className="hidden justify-self-end sm:block">
                  <Sparkline values={r.spark} color={r.color} aria-label={`tendance ${r.name}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/ComparatifMensuelSection.test.tsx`
Expected: PASS.

Note on the `/150/` and `/100/` assertions: `formatAmount` emits the euro amount containing those digit runs; if a locale nbsp splits them, keep the regex on the digit run only (already the case).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/ComparatifMensuelSection.tsx frontend/src/pages/Dashboard/__tests__/ComparatifMensuelSection.test.tsx
git commit -m "feat(dashboard): Comparatif mensuel section (query + toggle + rows)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire the section into the Dashboard

**Files:**
- Modify: `frontend/src/pages/Dashboard/index.tsx`
- Test: `frontend/src/pages/__tests__/Dashboard.test.tsx` (extend if it asserts section presence; otherwise rely on Task 3's test)

**Interfaces:**
- Consumes: `ComparatifMensuelSection` (Task 3), plus the existing `chartCurrency` and `chartScope` locals already computed in `index.tsx`.

- [ ] **Step 1: Add the import**

In `frontend/src/pages/Dashboard/index.tsx`, alongside the other Dashboard-local imports (near `import { MoyennesMensuellesSection } from './MoyennesMensuellesSection';`):

```tsx
import { ComparatifMensuelSection } from './ComparatifMensuelSection';
```

- [ ] **Step 2: Render the section below the donut**

Immediately after the "Category breakdown — donut" `</section>` block (the block that closes the `Répartition par catégorie` surface, around line 189), add:

```tsx
{/* Comparatif mensuel — per-category MoM comparison */}
{currencies.length > 0 && (
  <ComparatifMensuelSection currency={chartCurrency} accountId={chartScope} />
)}
```

- [ ] **Step 3: Run the Dashboard test + typecheck**

Run: `cd frontend && npx vitest run src/pages/__tests__/Dashboard.test.tsx && npx tsc --noEmit`
Expected: PASS, no type errors. If `Dashboard.test.tsx` mocks `api` and does NOT route `/api/reports/categories`/`/api/categories`, the new section will hit the default mock; confirm the existing test still passes (react-query `retry: false` means an unrouted call just renders the section's loading/empty branch and does not fail the suite). If it does fail, extend that test's `api` mock to route the two URLs to `{ rows: [] }` / `{ categories: [] }`.

- [ ] **Step 4: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/index.tsx frontend/src/pages/__tests__/Dashboard.test.tsx
git commit -m "feat(dashboard): render Comparatif mensuel below the donut

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Verify end-to-end**

Use the `verify` / `run` project skill (or `docker-compose up`) to launch the app, open the Dashboard, and confirm:
- The "Comparatif mensuel" section renders below the donut with the "· mois en cours" header note.
- Dépenses/Revenus toggle switches the list and re-colors deltas.
- Sparklines render per row; a brand-new category shows "nouveau".
- Switching the account scope selector refilters the section.

Record the observed result. No commit.
