# Insights Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Dashboard "Insights" section showing a ranked, notable-only list of narrative money insights about the last complete month.

**Architecture:** A pure, clock-independent helper (`insights.ts`) turns the existing `/api/reports/categories` + `/api/reports/budget` payloads into ranked `Insight[]`; a thin component (`InsightsSection.tsx`) fetches both endpoints, calls the helper, and renders rows (reusing the existing `Sparkline`). No backend changes.

**Tech Stack:** React + TypeScript, `@tanstack/react-query`, Vitest + `@testing-library/react`. Package manager: run commands from `frontend/`.

## Global Constraints

- All money insights describe the **last complete month** only (never the in-progress month). The helper is **clock-independent**: `months` and `referenceMonth` are injected as arguments — no `new Date()` inside `insights.ts`.
- Endpoint `month` field format is `"YYYY-MM"` (from `to_char(..., 'YYYY-MM')`). Test fixtures and month keys MUST use `"YYYY-MM"`, not `"YYYY-MM-DD"`.
- Section is **global** (all accounts) and **independent of the range picker**, like `MoyennesMensuellesSection`.
- Skip rows where `category_is_internal_transfer` is true and rows whose `Number(total)` is non-finite or `0` (matches existing aggregation).
- French copy, lower-case month names. Percentages format as `+18,0 %` (one decimal, comma separator, `%` preceded by a space); a leading `+` only for positive (negatives already carry `-` from `toFixed`).
- Amounts via `formatAmount(value, currency)` from `frontend/src/lib/format.ts`.
- Thresholds are module constants in `insights.ts`: `DELTA_PCT_MIN = 10`, `SAVINGS_DEV_MIN = 10`, `MOVER_ABS_MIN = 50`, `MOVER_PCT_MIN = 30`, `TOP_N = 4`.
- Reuse (no change): `frontend/src/components/Sparkline.tsx`, the month helpers in `frontend/src/pages/Dashboard/helpers.ts` (`AVG_WINDOW_MONTHS`, `monthAgoISODate`, `lastDayOfPrevMonthISODate`).
- Commit after each task. Do not stage the pre-existing unrelated changes (`.gitignore`, `docs/standalone-app-distribution.md`) — stage only the files each task names.

## File Structure

- Create `frontend/src/pages/Dashboard/insights.ts` — types + thresholds + `monthLabel` + pure `buildInsights`. One responsibility: turn payloads into ranked insights.
- Create `frontend/src/pages/Dashboard/InsightsSection.tsx` — data fetching + rendering. One responsibility: wire the helper to the two queries and the DOM.
- Create `frontend/src/pages/Dashboard/__tests__/insights.test.ts` — unit tests for `buildInsights`.
- Create `frontend/src/pages/Dashboard/__tests__/InsightsSection.test.tsx` — component tests (mocked `api`).
- Modify `frontend/src/pages/Dashboard/index.tsx` — render `<InsightsSection>` below `<MoyennesMensuellesSection>`.

---

### Task 1: Helper core — bucketing, spend-delta & income-delta insights, ranking

**Files:**
- Create: `frontend/src/pages/Dashboard/insights.ts`
- Test: `frontend/src/pages/Dashboard/__tests__/insights.test.ts`

**Interfaces:**
- Consumes: `CategoryReportRow`, `BudgetReportRow` from `../../api/types`; `formatAmount` from `../../lib/format`.
- Produces:
  - `type InsightTone = 'sage' | 'clay' | 'neutral'`
  - `interface Insight { key: string; icon: string; headline: string; detail: string | null; tone: InsightTone; score: number; spark?: number[] }`
  - `function monthLabel(key: string): string` — `"2026-06"` → `"juin"`
  - `function buildInsights(categoryRows: CategoryReportRow[], budgetRows: BudgetReportRow[], months: string[], referenceMonth: string, currency: string): Insight[]`
  - Later tasks add insight *types* inside `buildInsights`; the signature does not change.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Dashboard/__tests__/insights.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildInsights, monthLabel } from '../insights';
import type { CategoryReportRow, BudgetReportRow } from '../../../api/types';

function row(p: Partial<CategoryReportRow>): CategoryReportRow {
  return {
    category_id: null,
    category_name: null,
    category_kind: null,
    category_is_internal_transfer: false,
    month: '2026-06',
    total: '0',
    transaction_count: 0,
    ...p,
  };
}

const MONTHS = ['2026-04', '2026-05', '2026-06'];
const REF = '2026-06';

function build(rows: CategoryReportRow[], budgets: BudgetReportRow[] = []) {
  return buildInsights(rows, budgets, MONTHS, REF, 'EUR');
}

describe('monthLabel', () => {
  it('maps a YYYY-MM key to a lower-case French month', () => {
    expect(monthLabel('2026-06')).toBe('juin');
  });
});

describe('buildInsights — spend/income delta', () => {
  it('emits a notable spend-delta when spend rises >= 10% vs the prior month', () => {
    const rows = [
      row({ category_id: 1, category_name: 'Courses', month: '2026-05', total: '-1000.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-06', total: '-1200.00' }),
    ];
    const out = build(rows);
    const spend = out.find((i) => i.key === 'spend-delta');
    expect(spend).toBeDefined();
    expect(spend!.headline).toContain('juin');
    expect(spend!.detail).toContain('+20,0 %');
    expect(spend!.detail).toContain('mai');
    expect(spend!.tone).toBe('clay'); // spending more is unfavourable
    expect(spend!.spark).toBeDefined();
  });

  it('does NOT emit spend-delta when the change is under the threshold', () => {
    const rows = [
      row({ category_id: 1, month: '2026-05', total: '-1000.00' }),
      row({ category_id: 1, month: '2026-06', total: '-1050.00' }), // +5%
    ];
    expect(build(rows).some((i) => i.key === 'spend-delta')).toBe(false);
  });

  it('emits a notable income-delta with sage tone when income rises', () => {
    const rows = [
      row({ category_id: 2, category_name: 'Salaire', month: '2026-05', total: '2000.00' }),
      row({ category_id: 2, category_name: 'Salaire', month: '2026-06', total: '2400.00' }), // +20%
    ];
    const income = build(rows).find((i) => i.key === 'income-delta');
    expect(income).toBeDefined();
    expect(income!.tone).toBe('sage');
    expect(income!.headline).toContain('Vos revenus');
  });

  it('skips internal-transfer and non-finite rows', () => {
    const rows = [
      row({ category_id: 3, month: '2026-05', total: '-1000.00', category_is_internal_transfer: true }),
      row({ category_id: 3, month: '2026-06', total: '-2000.00', category_is_internal_transfer: true }),
      row({ category_id: 4, month: '2026-06', total: 'not-a-number' }),
    ];
    expect(build(rows)).toHaveLength(0);
  });

  it('returns at most TOP_N (4) insights', () => {
    // Big swings in many categories → more than 4 candidates.
    const rows = [
      row({ category_id: 1, category_name: 'A', month: '2026-05', total: '-1000.00' }),
      row({ category_id: 1, category_name: 'A', month: '2026-06', total: '-3000.00' }),
      row({ category_id: 5, category_name: 'Salaire', month: '2026-05', total: '1000.00' }),
      row({ category_id: 5, category_name: 'Salaire', month: '2026-06', total: '3000.00' }),
    ];
    expect(build(rows).length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/insights.test.ts`
Expected: FAIL — `buildInsights`/`monthLabel` not found (module doesn't exist).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/Dashboard/insights.ts`:

```ts
import type { CategoryReportRow, BudgetReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';

export type InsightTone = 'sage' | 'clay' | 'neutral';

export interface Insight {
  key: string;
  icon: string;
  headline: string;
  detail: string | null;
  tone: InsightTone;
  score: number;
  spark?: number[];
}

const DELTA_PCT_MIN = 10;
const SAVINGS_DEV_MIN = 10;
const MOVER_ABS_MIN = 50;
const MOVER_PCT_MIN = 30;
const TOP_N = 4;

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export function monthLabel(key: string): string {
  const [, m] = key.split('-');
  return MONTH_NAMES[Number(m) - 1] ?? key;
}

// "+18,0 %" / "-3,5 %". Positive gets an explicit '+'; negatives already
// carry '-' from toFixed. Never called with a non-finite value.
function signedPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1).replace('.', ',')} %`;
}

// "+150,00 €" / "-80,00 €".
function signedAmount(v: number, currency: string): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${formatAmount(v, currency)}`;
}

// sage when the movement is favourable, clay when not, neutral at zero.
function tone(favorableWhenUp: boolean, delta: number): InsightTone {
  if (delta === 0) return 'neutral';
  const favorable = favorableWhenUp ? delta > 0 : delta < 0;
  return favorable ? 'sage' : 'clay';
}

export function buildInsights(
  categoryRows: CategoryReportRow[],
  budgetRows: BudgetReportRow[],
  months: string[],
  referenceMonth: string,
  currency: string,
): Insight[] {
  const idxOf = new Map(months.map((m, i) => [m, i] as const));
  const refIdx = idxOf.get(referenceMonth) ?? -1;
  const prevIdx = refIdx - 1;
  const prevMonth = prevIdx >= 0 ? months[prevIdx] : null;

  const spendByMonth = new Array(months.length).fill(0) as number[];
  const incomeByMonth = new Array(months.length).fill(0) as number[];
  const catSpend = new Map<number | null, { name: string; spark: number[] }>();

  for (const r of categoryRows) {
    if (r.category_is_internal_transfer) continue;
    const amt = Number(r.total);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const i = idxOf.get(r.month);
    if (i === undefined) continue;
    if (amt < 0) {
      spendByMonth[i] += -amt;
      let c = catSpend.get(r.category_id);
      if (!c) {
        c = { name: r.category_name ?? 'Sans catégorie', spark: new Array(months.length).fill(0) };
        catSpend.set(r.category_id, c);
      }
      c.spark[i] += -amt;
    } else {
      incomeByMonth[i] += amt;
    }
  }

  const activeCount =
    months.filter((_, i) => spendByMonth[i] > 0 || incomeByMonth[i] > 0).length || 1;
  const avgSpend = spendByMonth.reduce((a, b) => a + b, 0) / activeCount;
  const avgIncome = incomeByMonth.reduce((a, b) => a + b, 0) / activeCount;

  const sparkOf = (arr: number[]) => arr.slice(Math.max(0, refIdx - 5), refIdx + 1);

  const insights: Insight[] = [];

  if (refIdx >= 0 && prevMonth !== null) {
    // spend-delta
    const curSpend = spendByMonth[refIdx];
    const prevSpend = spendByMonth[prevIdx];
    if (prevSpend > 0) {
      const pct = ((curSpend - prevSpend) / prevSpend) * 100;
      if (Math.abs(pct) >= DELTA_PCT_MIN) {
        let detail = `${signedPct(pct)} vs ${monthLabel(prevMonth)}`;
        if (avgSpend > 0 && Math.abs((curSpend - avgSpend) / avgSpend) * 100 >= DELTA_PCT_MIN) {
          detail += curSpend > avgSpend ? ' · au-dessus de votre moyenne' : ' · en-dessous de votre moyenne';
        }
        insights.push({
          key: 'spend-delta',
          icon: pct > 0 ? '📈' : '📉',
          headline: `Vos dépenses de ${monthLabel(referenceMonth)} : ${formatAmount(curSpend, currency)}`,
          detail,
          tone: tone(false, curSpend - prevSpend),
          score: Math.abs(pct),
          spark: sparkOf(spendByMonth),
        });
      }
    }

    // income-delta
    const curIncome = incomeByMonth[refIdx];
    const prevIncome = incomeByMonth[prevIdx];
    if (prevIncome > 0) {
      const pct = ((curIncome - prevIncome) / prevIncome) * 100;
      if (Math.abs(pct) >= DELTA_PCT_MIN) {
        insights.push({
          key: 'income-delta',
          icon: pct > 0 ? '📈' : '📉',
          headline: `Vos revenus de ${monthLabel(referenceMonth)} : ${formatAmount(curIncome, currency)}`,
          detail: `${signedPct(pct)} vs ${monthLabel(prevMonth)}`,
          tone: tone(true, curIncome - prevIncome),
          score: Math.abs(pct),
          spark: sparkOf(incomeByMonth),
        });
      }
    }
  }

  insights.sort((a, b) => b.score - a.score); // stable: equal scores keep catalog (push) order
  return insights.slice(0, TOP_N);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/insights.test.ts`
Expected: PASS (all cases in the file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/insights.ts frontend/src/pages/Dashboard/__tests__/insights.test.ts
git commit -m "feat(dashboard): insights helper — spend/income delta + ranking"
```

---

### Task 2: Savings insight

**Files:**
- Modify: `frontend/src/pages/Dashboard/insights.ts` (inside `buildInsights`, after the income-delta block, still within the `refIdx >= 0` guard)
- Test: `frontend/src/pages/Dashboard/__tests__/insights.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: the `spendByMonth`, `incomeByMonth`, `avgSpend`, `avgIncome`, `refIdx`, `referenceMonth` locals from Task 1.
- Produces: an insight with `key: 'savings'`. No signature change.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/pages/Dashboard/__tests__/insights.test.ts`:

```ts
describe('buildInsights — savings', () => {
  it('flags a month where spending exceeded income with the top score', () => {
    const rows = [
      row({ category_id: 2, category_name: 'Salaire', month: '2026-06', total: '500.00' }),
      row({ category_id: 1, category_name: 'Courses', month: '2026-06', total: '-1000.00' }),
    ];
    const out = build(rows);
    const savings = out.find((i) => i.key === 'savings');
    expect(savings).toBeDefined();
    expect(savings!.icon).toBe('⚠️');
    expect(savings!.headline).toContain('plus que vos revenus');
    expect(savings!.tone).toBe('clay');
    expect(savings!.score).toBe(100);
  });

  it('does not emit a savings insight when the rate is near the historical average', () => {
    // Same 50% savings rate every month → deviation 0 → not notable.
    const rows = [
      row({ category_id: 2, month: '2026-04', total: '2000.00' }),
      row({ category_id: 1, month: '2026-04', total: '-1000.00' }),
      row({ category_id: 2, month: '2026-05', total: '2000.00' }),
      row({ category_id: 1, month: '2026-05', total: '-1000.00' }),
      row({ category_id: 2, month: '2026-06', total: '2000.00' }),
      row({ category_id: 1, month: '2026-06', total: '-1000.00' }),
    ];
    expect(build(rows).some((i) => i.key === 'savings')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/insights.test.ts -t savings`
Expected: FAIL — the negative-savings test finds no `savings` insight.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/pages/Dashboard/insights.ts`, inside `buildInsights`, add this block immediately after the income-delta block and still inside the `if (refIdx >= 0 && prevMonth !== null) { ... }` — place it just before the closing `}` of that `if`:

```ts
    // savings
    const income = incomeByMonth[refIdx];
    const spend = spendByMonth[refIdx];
    const savings = income - spend;
    if (savings < 0) {
      insights.push({
        key: 'savings',
        icon: '⚠️',
        headline: `Vous avez dépensé plus que vos revenus en ${monthLabel(referenceMonth)}`,
        detail: `Solde : ${formatAmount(savings, currency)}`,
        tone: 'clay',
        score: 100,
      });
    } else if (income > 0) {
      const rate = (savings / income) * 100;
      const avgSavings = avgIncome - avgSpend;
      const avgRate = avgIncome > 0 ? (avgSavings / avgIncome) * 100 : 0;
      const dev = Math.abs(rate - avgRate);
      if (dev >= SAVINGS_DEV_MIN) {
        insights.push({
          key: 'savings',
          icon: '🐷',
          headline: `Vous avez épargné ${formatAmount(savings, currency)} en ${monthLabel(referenceMonth)} (${Math.round(rate)} % de vos revenus)`,
          detail: rate > avgRate ? 'Au-dessus de votre taux d’épargne habituel' : 'En-dessous de votre taux d’épargne habituel',
          tone: tone(true, rate - avgRate),
          score: dev,
        });
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/insights.test.ts`
Expected: PASS (savings cases plus all Task 1 cases still green).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/insights.ts frontend/src/pages/Dashboard/__tests__/insights.test.ts
git commit -m "feat(dashboard): insights — savings-rate insight"
```

---

### Task 3: Category mover insights (top increase / top decrease)

**Files:**
- Modify: `frontend/src/pages/Dashboard/insights.ts` (inside `buildInsights`, inside the `refIdx >= 0 && prevMonth !== null` guard, after the savings block)
- Test: `frontend/src/pages/Dashboard/__tests__/insights.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `catSpend`, `refIdx`, `prevIdx`, `prevMonth`, module constants `MOVER_ABS_MIN`/`MOVER_PCT_MIN`.
- Produces: insights with `key: 'top-increase'` and/or `key: 'top-decrease'`. No signature change.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/pages/Dashboard/__tests__/insights.test.ts`:

```ts
describe('buildInsights — category movers', () => {
  it('picks the largest spend increase and formats the delta', () => {
    const rows = [
      row({ category_id: 1, category_name: 'Restaurants', month: '2026-05', total: '-400.00' }),
      row({ category_id: 1, category_name: 'Restaurants', month: '2026-06', total: '-550.00' }), // +150 (+37.5%)
      row({ category_id: 2, category_name: 'Courses', month: '2026-05', total: '-1000.00' }),
      row({ category_id: 2, category_name: 'Courses', month: '2026-06', total: '-1020.00' }), // +20 (+2%) — below thresholds
    ];
    const inc = build(rows).find((i) => i.key === 'top-increase');
    expect(inc).toBeDefined();
    expect(inc!.headline).toContain('Restaurants');
    expect(inc!.detail).toContain('+150,00');
    expect(inc!.detail).toContain('+37,5 %');
    expect(inc!.tone).toBe('clay');
  });

  it('labels a from-zero category as "nouveau"', () => {
    const rows = [
      row({ category_id: 9, category_name: 'Vacances', month: '2026-06', total: '-300.00' }), // prev 0
    ];
    const inc = build(rows).find((i) => i.key === 'top-increase');
    expect(inc).toBeDefined();
    expect(inc!.detail).toBe('nouveau');
    expect(inc!.score).toBe(100); // capped
  });

  it('picks the largest spend decrease with sage tone', () => {
    const rows = [
      row({ category_id: 3, category_name: 'Essence', month: '2026-05', total: '-300.00' }),
      row({ category_id: 3, category_name: 'Essence', month: '2026-06', total: '-100.00' }), // -200 (-66.7%)
    ];
    const dec = build(rows).find((i) => i.key === 'top-decrease');
    expect(dec).toBeDefined();
    expect(dec!.headline).toContain('Essence');
    expect(dec!.detail).toContain('-200,00');
    expect(dec!.tone).toBe('sage');
  });

  it('ignores movers below the absolute floor', () => {
    const rows = [
      row({ category_id: 4, category_name: 'Café', month: '2026-05', total: '-10.00' }),
      row({ category_id: 4, category_name: 'Café', month: '2026-06', total: '-45.00' }), // +35 (>30% but < 50€ floor)
    ];
    expect(build(rows).some((i) => i.key === 'top-increase')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/insights.test.ts -t movers`
Expected: FAIL — no `top-increase`/`top-decrease` insights emitted.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/pages/Dashboard/insights.ts`, inside `buildInsights`, add after the savings block (still inside the `refIdx >= 0 && prevMonth !== null` guard):

```ts
    // category movers (spend only)
    let topInc: { name: string; d: number; pct: number; fromZero: boolean } | null = null;
    let topDec: { name: string; d: number; pct: number } | null = null;
    for (const c of catSpend.values()) {
      const cur = c.spark[refIdx];
      const prev = c.spark[prevIdx];
      const d = cur - prev;
      if (d > 0) {
        const fromZero = prev === 0;
        const pct = fromZero ? Infinity : (d / prev) * 100;
        const notable = d >= MOVER_ABS_MIN && (fromZero || pct >= MOVER_PCT_MIN);
        if (notable && (!topInc || d > topInc.d)) topInc = { name: c.name, d, pct, fromZero };
      } else if (d < 0) {
        const pct = prev > 0 ? (d / prev) * 100 : 0;
        const notable = -d >= MOVER_ABS_MIN && pct <= -MOVER_PCT_MIN;
        if (notable && (!topDec || d < topDec.d)) topDec = { name: c.name, d, pct };
      }
    }
    if (topInc) {
      insights.push({
        key: 'top-increase',
        icon: '🔺',
        headline: `Plus forte hausse : ${topInc.name}`,
        detail: topInc.fromZero
          ? 'nouveau'
          : `${signedAmount(topInc.d, currency)} (${signedPct(topInc.pct)}) vs ${monthLabel(prevMonth)}`,
        tone: 'clay',
        score: Math.min(Math.abs(topInc.pct), 100),
      });
    }
    if (topDec) {
      insights.push({
        key: 'top-decrease',
        icon: '🔻',
        headline: `Plus forte baisse : ${topDec.name}`,
        detail: `${signedAmount(topDec.d, currency)} (${signedPct(topDec.pct)}) vs ${monthLabel(prevMonth)}`,
        tone: 'sage',
        score: Math.min(Math.abs(topDec.pct), 100),
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/insights.test.ts`
Expected: PASS (mover cases + all earlier cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/insights.ts frontend/src/pages/Dashboard/__tests__/insights.test.ts
git commit -m "feat(dashboard): insights — top category movers"
```

---

### Task 4: Budget-overrun insight

**Files:**
- Modify: `frontend/src/pages/Dashboard/insights.ts` (inside `buildInsights`, **outside** the `prevMonth` guard — budget data does not depend on a prior month; place it just before the `insights.sort(...)` call)
- Test: `frontend/src/pages/Dashboard/__tests__/insights.test.ts` (add a `describe` block)

**Interfaces:**
- Consumes: `budgetRows` (the `BudgetReportRow[]` argument), `referenceMonth`.
- Produces: an insight with `key: 'budget-overruns'`. No signature change.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/pages/Dashboard/__tests__/insights.test.ts`:

```ts
function budgetRow(p: Partial<BudgetReportRow>): BudgetReportRow {
  return {
    categoryId: 1,
    name: 'Cat',
    color: null,
    limit: '100.00',
    currency: 'EUR',
    spent: '0.00',
    remaining: '100.00',
    pct: 0,
    over: false,
    ...p,
  };
}

describe('buildInsights — budget overruns', () => {
  it('counts only over-budget rows and lists their names', () => {
    const budgets = [
      budgetRow({ categoryId: 1, name: 'Courses', over: true }),
      budgetRow({ categoryId: 2, name: 'Loisirs', over: true }),
      budgetRow({ categoryId: 3, name: 'Transport', over: false }),
    ];
    const out = build([], budgets);
    const b = out.find((i) => i.key === 'budget-overruns');
    expect(b).toBeDefined();
    expect(b!.headline).toContain('2 budgets dépassés');
    expect(b!.detail).toContain('Courses');
    expect(b!.detail).toContain('Loisirs');
    expect(b!.detail).not.toContain('Transport');
    expect(b!.tone).toBe('clay');
  });

  it('emits no budget insight when nothing is over budget', () => {
    expect(build([], [budgetRow({ over: false })]).some((i) => i.key === 'budget-overruns')).toBe(false);
  });

  it('returns an empty array when no insight clears its threshold', () => {
    expect(build([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/insights.test.ts -t "budget"`
Expected: FAIL — no `budget-overruns` insight emitted.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/pages/Dashboard/insights.ts`, inside `buildInsights`, add this block **after** the closing `}` of the `if (refIdx >= 0 && prevMonth !== null)` guard and **before** `insights.sort(...)`:

```ts
  // budget overruns (independent of the prior month)
  const over = budgetRows.filter((r) => r.over);
  if (over.length > 0) {
    const names = over.map((r) => r.name);
    const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
    const plural = over.length > 1 ? 's' : '';
    insights.push({
      key: 'budget-overruns',
      icon: '⚠️',
      headline: `${over.length} budget${plural} dépassé${plural} en ${monthLabel(referenceMonth)}`,
      detail: shown,
      tone: 'clay',
      score: 50 + 10 * over.length,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/insights.test.ts`
Expected: PASS (all cases across the file).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/insights.ts frontend/src/pages/Dashboard/__tests__/insights.test.ts
git commit -m "feat(dashboard): insights — budget-overrun insight"
```

---

### Task 5: `InsightsSection` component + wire into Dashboard

**Files:**
- Create: `frontend/src/pages/Dashboard/InsightsSection.tsx`
- Test: `frontend/src/pages/Dashboard/__tests__/InsightsSection.test.tsx`
- Modify: `frontend/src/pages/Dashboard/index.tsx`

**Interfaces:**
- Consumes: `buildInsights`, `monthLabel`, `InsightTone` from `./insights`; `Sparkline` from `../../components/Sparkline`; `AVG_WINDOW_MONTHS`, `monthAgoISODate`, `lastDayOfPrevMonthISODate` from `./helpers`; `api` from `../../api/client`; `CategoryReportRow`, `BudgetReportRow` from `../../api/types`.
- Produces: `export function InsightsSection({ currency }: { currency: string }): JSX.Element | null`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Dashboard/__tests__/InsightsSection.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InsightsSection } from '../InsightsSection';

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, api: vi.fn() };
});

import { api } from '../../../api/client';
const apiMock = vi.mocked(api);

function renderWithProviders(currency = 'EUR') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InsightsSection currency={currency} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  // Pin the clock so referenceMonth === '2026-06' deterministically. Fake ONLY
  // Date — leaving setTimeout/setInterval real so Testing Library's findBy/
  // waitFor polling still advances (faking all timers would hang them).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

// Category rows produce a +20% spend rise (June vs May); budget resolves empty.
function mockNotable() {
  apiMock.mockImplementation((path: string) => {
    if (path.includes('budget')) return Promise.resolve({ month: '2026-06', rows: [], totals: { limit: '0', spent: '0' } });
    return Promise.resolve({
      rows: [
        { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-05', total: '-1000.00', transaction_count: 1 },
        { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-06', total: '-1200.00', transaction_count: 1 },
      ],
    });
  });
}

describe('InsightsSection', () => {
  it('renders the reference month in the header', async () => {
    mockNotable();
    renderWithProviders();
    expect(await screen.findByText(/juin/i)).toBeInTheDocument();
  });

  it('renders a notable insight row', async () => {
    mockNotable();
    renderWithProviders();
    expect(await screen.findByText(/Vos dépenses de juin/i)).toBeInTheDocument();
    expect(screen.getByText(/\+20,0 %/)).toBeInTheDocument();
  });

  it('shows the empty state when no insight clears a threshold', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.includes('budget')) return Promise.resolve({ month: '2026-06', rows: [], totals: { limit: '0', spent: '0' } });
      return Promise.resolve({ rows: [] });
    });
    renderWithProviders();
    expect(await screen.findByText(/Rien de notable/i)).toBeInTheDocument();
  });

  it('still renders money insights when the budget query fails', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.includes('budget')) return Promise.reject(new Error('boom'));
      return Promise.resolve({
        rows: [
          { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-05', total: '-1000.00', transaction_count: 1 },
          { category_id: 1, category_name: 'Courses', category_kind: null, category_is_internal_transfer: false, month: '2026-06', total: '-1200.00', transaction_count: 1 },
        ],
      });
    });
    renderWithProviders();
    expect(await screen.findByText(/Vos dépenses de juin/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/InsightsSection.test.tsx`
Expected: FAIL — `../InsightsSection` module not found.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/Dashboard/InsightsSection.tsx`:

```tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { CategoryReportRow, BudgetReportRow } from '../../api/types';
import { Sparkline } from '../../components/Sparkline';
import { AVG_WINDOW_MONTHS, monthAgoISODate, lastDayOfPrevMonthISODate } from './helpers';
import { buildInsights, monthLabel, type InsightTone } from './insights';

const TONE_CLASS: Record<InsightTone, string> = {
  sage: 'text-sage-300',
  clay: 'text-clay-300',
  neutral: 'text-ink-400',
};

// The chronological complete-month window: `count` months ending at the last
// complete month (current month - 1). Matches the fromDate/toDate fetch below.
function completeMonthWindow(count: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = count; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

interface Props {
  currency: string;
}

export function InsightsSection({ currency }: Props): JSX.Element | null {
  const months = useMemo(() => completeMonthWindow(AVG_WINDOW_MONTHS, new Date()), []);
  const referenceMonth = months[months.length - 1];
  const fromDate = monthAgoISODate(AVG_WINDOW_MONTHS);
  const toDate = lastDayOfPrevMonthISODate();

  const catQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate, toDate }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', { query: { fromDate, toDate } }),
  });
  const budgetQ = useQuery({
    queryKey: ['reports', 'budget', { month: referenceMonth }],
    queryFn: () =>
      api<{ rows: BudgetReportRow[] }>('/api/reports/budget', { query: { month: referenceMonth } }),
  });

  const insights = useMemo(
    () =>
      buildInsights(
        catQ.data?.rows ?? [],
        budgetQ.data?.rows ?? [],
        months,
        referenceMonth,
        currency,
      ),
    [catQ.data, budgetQ.data, months, referenceMonth, currency],
  );

  if (catQ.isLoading) {
    return (
      <section>
        <div className="section-rule mb-4">Insights</div>
        <div className="h-32 animate-pulse rounded-lg bg-ink-900" />
      </section>
    );
  }

  return (
    <section>
      <div className="section-rule mb-4">
        Insights{' '}
        <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
          — {monthLabel(referenceMonth)}
        </span>
      </div>

      {catQ.isError ? (
        <div className="surface p-5 text-sm text-clay-300">
          Erreur de chargement des insights.
        </div>
      ) : insights.length === 0 ? (
        <div className="surface p-5 text-sm text-ink-400 display-italic">
          Rien de notable ce mois-ci.
        </div>
      ) : (
        <div className="surface divide-y divide-ink-850">
          {insights.map((ins) => (
            <div key={ins.key} className="flex items-start gap-3 px-4 py-3">
              <span className="text-lg leading-none" aria-hidden>
                {ins.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-ink-100">{ins.headline}</div>
                {ins.detail && (
                  <div className={`text-sm ${TONE_CLASS[ins.tone]}`}>{ins.detail}</div>
                )}
              </div>
              {ins.spark && (
                <Sparkline values={ins.spark} aria-label={`tendance ${monthLabel(referenceMonth)}`} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/Dashboard/__tests__/InsightsSection.test.tsx`
Expected: PASS (all four cases).

- [ ] **Step 5: Wire the section into the Dashboard**

In `frontend/src/pages/Dashboard/index.tsx`:

Add the import next to the existing section imports (after the `MoyennesMensuellesSection` import, around line 12):

```tsx
import { MoyennesMensuellesSection } from './MoyennesMensuellesSection';
import { InsightsSection } from './InsightsSection';
```

Render it directly below the Moyennes section (the line currently reading `{primary && <MoyennesMensuellesSection currency={primary.currency} />}`):

```tsx
      {primary && <MoyennesMensuellesSection currency={primary.currency} />}
      {primary && <InsightsSection currency={primary.currency} />}
```

- [ ] **Step 6: Typecheck and run the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: `TypeScript: No errors found`; all test files PASS (0 failures), including the two new files.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Dashboard/InsightsSection.tsx frontend/src/pages/Dashboard/__tests__/InsightsSection.test.tsx frontend/src/pages/Dashboard/index.tsx
git commit -m "feat(dashboard): Insights panel section + wire into Dashboard"
```

---

## Self-Review

**Spec coverage:**
- Data sources (categories + budget with `month=M`) → Task 5 fetches both. ✓
- Reference = last complete month, clock-independent helper → Global Constraints + Task 1 (`months`/`referenceMonth` injected); component derives them. ✓
- Insight catalog (spend-delta, income-delta, savings, top-increase, top-decrease, budget-overruns) → Tasks 1–4. ✓
- Ranking by score, top 4, catalog-order tie-break → Task 1 (`sort` + `slice(0, TOP_N)`, stable sort preserves push order). ✓
- Sparkline on spend/income rows → Task 1 attaches `spark`; Task 5 renders `<Sparkline>`. ✓
- Loading skeleton, error surface (categories fatal, budget non-fatal), empty state → Task 5 + its tests. ✓
- Placement below Moyennes, global, range-independent → Task 5 Step 5 + Global Constraints. ✓
- Testing (helper unit tests per insight + component tests) → Tasks 1–5. ✓

**Placeholder scan:** No TBD/TODO; every code and test step is complete. ✓

**Type consistency:** `Insight`/`InsightTone`/`buildInsights`/`monthLabel` names and the `buildInsights(categoryRows, budgetRows, months, referenceMonth, currency)` signature are identical across Tasks 1–5. `BudgetReportRow` fields (`over`, `name`) match `frontend/src/api/types.ts`. `CategoryReportRow` fixture fields match the type. `api` called as `api<T>(path, { query })`, matching `client.ts`. ✓
