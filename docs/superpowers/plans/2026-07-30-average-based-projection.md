# Average-Based Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard Trend chart's recurring-series projection with a sawtooth extrapolation from historical monthly averages, so the projected slope matches the observed trend.

**Architecture:** Two new pure functions in `frontend/src/lib/average-forecast.ts` (sawtooth generator + per-account monthly flow averages from balance deltas), plus the Moyennes mensuelles per-month aggregation extracted to a shared pure helper so the tiles and the projection can never disagree. `pages/Dashboard/index.tsx` swaps its `recurringQ`-driven overlay for these. `lib/recurring-forecast.ts` and the Récurrent → Prévision tab are untouched.

**Tech Stack:** React + TypeScript, TanStack Query, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-30-average-based-projection-design.md`

## Global Constraints

- ESLint `max-lines`: 300 per file (blank lines/comments skipped); tests exempt. `pages/Dashboard/index.tsx` is near the cap — the diff there must stay roughly size-neutral (it does: the removed recurring block is bigger than the added one).
- Commit identity: every commit uses `git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit …` and ends the message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Commit directly to `main`. Do NOT push — the user pushes explicitly.
- Date arithmetic: UTC-safe ISO math (`Date.UTC`), never local-time `new Date(string)` parsing. `addDaysIso` is intentionally duplicated as a module-private helper across the codebase (recurring-forecast, UpcomingTab, demo handlers) — copy it, don't refactor it into a shared module.
- i18n: any user-facing string goes in BOTH `frontend/src/locales/fr/` and `frontend/src/locales/en/` — the i18n smoke test checks parity.
- Amount conventions to keep straight: `computeMonthlyStats().avgSpend` is **signed negative** (sum of negative amounts); `projectAverageBalance` and `monthlyFlowAverages` use **positive magnitudes** for spend. Conversions are explicit at the call site (`-stats.avgSpend`).
- All commands below run from `frontend/`: `cd /Users/julienhuguel/superconductor/projects/Athena-Accounting/frontend`.

---

### Task 1: `projectAverageBalance` — the sawtooth generator

**Files:**
- Create: `frontend/src/lib/average-forecast.ts`
- Test: `frontend/src/lib/__tests__/average-forecast.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports beyond types).
- Produces (Tasks 2 and 4 rely on these exact names):

```ts
export interface AverageProjectionPoint { date: string; value: number }
export interface ProjectAverageBalanceOptions {
  startBalance: number;
  avgMonthlyIncome: number; // positive €/month
  avgMonthlySpend: number;  // positive magnitude €/month
  horizonDays: number;
  startDate: string;        // YYYY-MM-DD — emitted as index 0, untouched
}
export function projectAverageBalance(opts: ProjectAverageBalanceOptions): AverageProjectionPoint[]
```

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/__tests__/average-forecast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectAverageBalance } from '../average-forecast';

describe('projectAverageBalance', () => {
  it('returns [] for a non-positive horizon', () => {
    expect(
      projectAverageBalance({ startBalance: 100, avgMonthlyIncome: 0, avgMonthlySpend: 0, horizonDays: 0, startDate: '2026-08-01' }),
    ).toEqual([]);
  });

  it('emits horizonDays + 1 samples, index 0 = startDate at startBalance', () => {
    const out = projectAverageBalance({ startBalance: 1000, avgMonthlyIncome: 0, avgMonthlySpend: 0, horizonDays: 30, startDate: '2026-08-15' });
    expect(out).toHaveLength(31);
    expect(out[0]).toEqual({ date: '2026-08-15', value: 1000 });
    expect(out[30]!.date).toBe('2026-09-14');
  });

  it('steps up by avgMonthlyIncome on the 1st of each month', () => {
    const out = projectAverageBalance({ startBalance: 500, avgMonthlyIncome: 3000, avgMonthlySpend: 0, horizonDays: 20, startDate: '2026-08-25' });
    const aug31 = out.find((p) => p.date === '2026-08-31')!;
    const sep01 = out.find((p) => p.date === '2026-09-01')!;
    expect(aug31.value).toBe(500);       // no income before the month boundary
    expect(sep01.value).toBe(3500);      // salary lands on the 1st
  });

  it('drifts down by avgMonthlySpend spread over the days of each month', () => {
    // August has 31 days → 310/31 = 10 €/day.
    const out = projectAverageBalance({ startBalance: 1000, avgMonthlyIncome: 0, avgMonthlySpend: 310, horizonDays: 3, startDate: '2026-08-10' });
    expect(out[1]!.value).toBeCloseTo(990, 6);
    expect(out[3]!.value).toBeCloseTo(970, 6);
  });

  it('uses each month own length for the drift (Feb 2027 = 28 days)', () => {
    const out = projectAverageBalance({ startBalance: 0, avgMonthlyIncome: 0, avgMonthlySpend: 280, horizonDays: 2, startDate: '2027-02-10' });
    expect(out[1]!.value).toBeCloseTo(-10, 6);
  });

  it('nets exactly income − spend over one full month', () => {
    // startDate on the last day of July → days 1..31 cover all of August.
    const out = projectAverageBalance({ startBalance: 2000, avgMonthlyIncome: 3000, avgMonthlySpend: 2500, horizonDays: 31, startDate: '2026-07-31' });
    expect(out[31]!.date).toBe('2026-08-31');
    expect(out[31]!.value).toBeCloseTo(2500, 6); // 2000 + 3000 − 2500
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/average-forecast.test.ts`
Expected: FAIL — cannot resolve `../average-forecast`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/average-forecast.ts`:

```ts
// Pure balance projection driven by historical monthly averages. No React,
// no fetch — the Dashboard Trend chart overlay plugs the output into
// BalanceChart's `projection` prop. Unlike lib/recurring-forecast.ts (which
// replays confirmed recurring series and therefore ignores everything the
// user never confirmed), this extrapolates the observed averages, so the
// projected slope always matches the historical trend.

export interface AverageProjectionPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface ProjectAverageBalanceOptions {
  startBalance: number;
  avgMonthlyIncome: number; // positive €/month
  avgMonthlySpend: number; // positive magnitude €/month
  horizonDays: number;
  startDate: string; // YYYY-MM-DD — emitted as index 0, untouched
}

// UTC-safe ISO day arithmetic — matches recurring-forecast + UpcomingTab.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function daysInMonthOf(iso: string): number {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Sawtooth: +avgMonthlyIncome lands on the 1st of each projected month (the
// "salary day"), while avgMonthlySpend drains as a daily drift sized to that
// month's length. Net change over any full month = income − spend = average
// savings, so the projection's trend matches history by construction.
export function projectAverageBalance(opts: ProjectAverageBalanceOptions): AverageProjectionPoint[] {
  const { startBalance, avgMonthlyIncome, avgMonthlySpend, horizonDays, startDate } = opts;
  if (horizonDays <= 0) return [];

  const out: AverageProjectionPoint[] = [{ date: startDate, value: startBalance }];
  let running = startBalance;
  for (let i = 1; i <= horizonDays; i++) {
    const date = addDaysIso(startDate, i);
    if (date.endsWith('-01')) running += avgMonthlyIncome;
    running -= avgMonthlySpend / daysInMonthOf(date);
    out.push({ date, value: running });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/average-forecast.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/average-forecast.ts src/lib/__tests__/average-forecast.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(dashboard): pure sawtooth projection from monthly averages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `monthlyFlowAverages` — per-account averages from balance deltas

**Files:**
- Modify: `frontend/src/lib/average-forecast.ts` (append)
- Test: `frontend/src/lib/__tests__/average-forecast.test.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 1 (independent function in the same module).
- Produces (Task 4 relies on these exact names):

```ts
export interface MonthlyFlowAverages {
  monthCount: number;
  avgIncome: number; // positive €/month
  avgSpend: number;  // positive magnitude €/month
}
// `points` must already be scoped to ONE account (one row per bucket).
export function monthlyFlowAverages(
  points: Array<{ bucket: string; delta: string }>,
  todayIso: string,
  maxMonths?: number, // default 12
): MonthlyFlowAverages | null
```

Semantics (from the spec):
- Buckets group by calendar month (`bucket.slice(0, 7)`).
- The month containing the account's FIRST bucket is excluded — the backend folds the opening balance into that bucket's delta, which is not income.
- The current month (`todayIso.slice(0, 7)`) and anything after it is excluded — a half-finished month drags the average toward zero (same rationale as the Moyennes window).
- Only the last `maxMonths` remaining months count; months with no buckets simply don't appear (consistent with the Moyennes tiles, which also average over months present in the data).
- Per eligible month: income = Σ positive deltas, spend = Σ |negative deltas|. Returns the mean of each over `monthCount`, or `null` when no month is eligible.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/__tests__/average-forecast.test.ts`:

```ts
import { monthlyFlowAverages } from '../average-forecast';

function pt(bucket: string, delta: number): { bucket: string; delta: string } {
  return { bucket, delta: delta.toFixed(2) };
}

describe('monthlyFlowAverages', () => {
  it('returns null for an empty series', () => {
    expect(monthlyFlowAverages([], '2026-07-30')).toBeNull();
  });

  it('returns null when the only month is the opening month', () => {
    expect(monthlyFlowAverages([pt('2026-06-05', 1000)], '2026-07-30')).toBeNull();
  });

  it('excludes the opening month and the current month', () => {
    const points = [
      pt('2026-05-10', 5000), // opening balance folded here — must not count
      pt('2026-06-01', 2000),
      pt('2026-06-15', -800),
      pt('2026-07-02', 9999), // current month — must not count
    ];
    const out = monthlyFlowAverages(points, '2026-07-30')!;
    expect(out.monthCount).toBe(1);
    expect(out.avgIncome).toBeCloseTo(2000, 6);
    expect(out.avgSpend).toBeCloseTo(800, 6);
  });

  it('splits inflows and outflows within a month and averages across months', () => {
    const points = [
      pt('2026-03-01', 100), // opening month
      pt('2026-04-01', 2000),
      pt('2026-04-20', -500),
      pt('2026-05-01', 1000),
      pt('2026-05-20', -300),
    ];
    const out = monthlyFlowAverages(points, '2026-07-30')!;
    expect(out.monthCount).toBe(2);
    expect(out.avgIncome).toBeCloseTo(1500, 6); // (2000 + 1000) / 2
    expect(out.avgSpend).toBeCloseTo(400, 6); // (500 + 300) / 2
  });

  it('caps the window at maxMonths (default 12) most recent eligible months', () => {
    const points = [pt('2024-01-05', 100)]; // opening month
    // 2024-02 .. 2026-06 — 29 eligible months, income i € in month index i.
    let income = 0;
    for (let i = 0; i < 29; i++) {
      const y = 2024 + Math.floor((1 + i) / 12);
      const m = ((1 + i) % 12) + 1;
      income = i + 1;
      points.push(pt(`${y}-${String(m).padStart(2, '0')}-10`, income));
    }
    const out = monthlyFlowAverages(points, '2026-07-30')!;
    expect(out.monthCount).toBe(12);
    // Last 12 incomes are 18..29 → mean 23.5.
    expect(out.avgIncome).toBeCloseTo(23.5, 6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/average-forecast.test.ts`
Expected: FAIL — `monthlyFlowAverages` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `frontend/src/lib/average-forecast.ts`:

```ts
export interface MonthlyFlowAverages {
  monthCount: number;
  avgIncome: number; // positive €/month
  avgSpend: number; // positive magnitude €/month
}

// Average monthly inflow/outflow of a SINGLE account, derived from its
// balance-timeseries deltas. Used for the projection when the chart is
// scoped to one account: internal transfers DO move that account's balance,
// so the category-based averages (which exclude transfers) would lie here.
// Exclusions: the month of the first bucket (the backend folds the opening
// balance into it) and the current month (half-finished). Months absent
// from the data don't count — same behavior as the Moyennes tiles.
export function monthlyFlowAverages(
  points: Array<{ bucket: string; delta: string }>,
  todayIso: string,
  maxMonths = 12,
): MonthlyFlowAverages | null {
  if (points.length === 0) return null;
  let firstMonth = points[0]!.bucket.slice(0, 7);
  for (const p of points) {
    const m = p.bucket.slice(0, 7);
    if (m < firstMonth) firstMonth = m;
  }
  const currentMonth = todayIso.slice(0, 7);

  const monthly = new Map<string, { income: number; spend: number }>();
  for (const p of points) {
    const month = p.bucket.slice(0, 7);
    if (month <= firstMonth || month >= currentMonth) continue;
    const delta = Number(p.delta);
    if (!Number.isFinite(delta)) continue;
    const cur = monthly.get(month) ?? { income: 0, spend: 0 };
    if (delta > 0) cur.income += delta;
    else cur.spend += -delta;
    monthly.set(month, cur);
  }

  const months = [...monthly.keys()].sort().slice(-maxMonths);
  if (months.length === 0) return null;
  let income = 0;
  let spend = 0;
  for (const m of months) {
    const v = monthly.get(m)!;
    income += v.income;
    spend += v.spend;
  }
  return {
    monthCount: months.length,
    avgIncome: income / months.length,
    avgSpend: spend / months.length,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/average-forecast.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/average-forecast.ts src/lib/__tests__/average-forecast.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(dashboard): per-account monthly flow averages from balance deltas

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract `computeMonthlyStats` shared by tiles and projection

**Files:**
- Create: `frontend/src/pages/Dashboard/monthly-stats.ts`
- Modify: `frontend/src/pages/Dashboard/MoyennesMensuellesSection.tsx`
- Test: `frontend/src/pages/Dashboard/__tests__/monthly-stats.test.ts`

**Interfaces:**
- Consumes: `CategoryReportRow` from `frontend/src/api/types.ts` (fields used: `category_is_internal_transfer`, `month`, `total`).
- Produces (Task 4 relies on these exact names):

```ts
export interface MonthlyStats {
  monthCount: number;
  avgSpend: number;   // SIGNED — negative or 0
  avgIncome: number;  // positive or 0
  avgSavings: number; // avgIncome + avgSpend
}
export function computeMonthlyStats(rows: CategoryReportRow[]): MonthlyStats
```

The function body is the EXISTING `useMemo` body of `MoyennesMensuellesSection.tsx:25-58`, moved verbatim (including its comments). This is an extract-function refactor — no behavior change, the existing `MoyennesMensuellesSection.test.tsx` must pass untouched.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/Dashboard/__tests__/monthly-stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeMonthlyStats } from '../monthly-stats';
import type { CategoryReportRow } from '../../../api/types';

function row(month: string, total: string, isTransfer = false): CategoryReportRow {
  return {
    category_id: 1,
    category_name: 'X',
    category_kind: null,
    category_is_internal_transfer: isTransfer,
    month,
    total,
    transaction_count: 1,
  };
}

describe('computeMonthlyStats', () => {
  it('returns zeros with monthCount 0 on empty input (no /0)', () => {
    expect(computeMonthlyStats([])).toEqual({ monthCount: 0, avgSpend: 0, avgIncome: 0, avgSavings: 0 });
  });

  it('buckets signed totals per month and averages over months present', () => {
    const out = computeMonthlyStats([
      row('2026-05', '3000.00'),
      row('2026-05', '-1200.00'),
      row('2026-06', '2000.00'),
      row('2026-06', '-800.00'),
    ]);
    expect(out.monthCount).toBe(2);
    expect(out.avgIncome).toBeCloseTo(2500, 6);
    expect(out.avgSpend).toBeCloseTo(-1000, 6); // signed negative
    expect(out.avgSavings).toBeCloseTo(1500, 6);
  });

  it('skips internal-transfer categories entirely', () => {
    const out = computeMonthlyStats([
      row('2026-06', '2000.00'),
      row('2026-06', '-500.00', true), // Épargne-style transfer leg
    ]);
    expect(out.avgSpend).toBe(0);
    expect(out.avgIncome).toBeCloseTo(2000, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/pages/Dashboard/__tests__/monthly-stats.test.ts`
Expected: FAIL — cannot resolve `../monthly-stats`.

- [ ] **Step 3: Create the module and refactor the section**

Create `frontend/src/pages/Dashboard/monthly-stats.ts` — the body is lines 25–58 of `MoyennesMensuellesSection.tsx` moved as-is:

```ts
import type { CategoryReportRow } from '../../api/types';

export interface MonthlyStats {
  monthCount: number;
  avgSpend: number; // signed (≤ 0)
  avgIncome: number;
  avgSavings: number;
}

// Shared by the Moyennes mensuelles tiles and the Trend chart's projection
// overlay — one computation so the two can never display different averages.
export function computeMonthlyStats(rows: CategoryReportRow[]): MonthlyStats {
  // Aggregate signed totals per month using the SIGN of the amount
  // (backend already excludes rows where transfer_group_id IS NOT NULL).
  // We also skip rows whose category is flagged `is_internal_transfer` so
  // users who don't rely on the auto mirror-leg detector — and instead tag
  // one side of a self-transfer with a dedicated category (e.g. "Épargne")
  // — get honest averages. Skipped from BOTH buckets so avgSavings stays
  // consistent (revenue − expenses cancels out on both legs).
  const monthly = new Map<string, { spend: number; income: number }>();
  for (const r of rows) {
    if (r.category_is_internal_transfer) continue;
    const cur = monthly.get(r.month) ?? { spend: 0, income: 0 };
    const amount = Number(r.total);
    if (!Number.isFinite(amount)) continue;
    if (amount < 0) cur.spend += amount;
    else if (amount > 0) cur.income += amount;
    monthly.set(r.month, cur);
  }
  // Guard against /0 when there is no history yet.
  const monthCount = monthly.size || 1;
  let totalSpend = 0;
  let totalIncome = 0;
  for (const v of monthly.values()) {
    totalSpend += v.spend;
    totalIncome += v.income;
  }
  return {
    monthCount: monthly.size,
    avgSpend: totalSpend / monthCount,
    avgIncome: totalIncome / monthCount,
    avgSavings: (totalIncome + totalSpend) / monthCount,
  };
}
```

In `MoyennesMensuellesSection.tsx`, replace the whole `monthlyStats` `useMemo` (lines 25–58) with:

```ts
const monthlyStats = useMemo(() => computeMonthlyStats(statsQ.data?.rows ?? []), [statsQ.data]);
```

and update imports: add `import { computeMonthlyStats } from './monthly-stats';`, keep `useMemo`, and remove the now-unused `CategoryReportRow` type import ONLY if the file no longer references it (it still does — the `statsQ` generic uses it — so keep it).

- [ ] **Step 4: Run the new test and the existing section test**

Run: `npx vitest run src/pages/Dashboard/__tests__/monthly-stats.test.ts src/pages/Dashboard/__tests__/MoyennesMensuellesSection.test.tsx`
Expected: PASS — both files, section test unmodified.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard/monthly-stats.ts src/pages/Dashboard/MoyennesMensuellesSection.tsx src/pages/Dashboard/__tests__/monthly-stats.test.ts
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "refactor(dashboard): extract computeMonthlyStats for reuse by the projection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the dashboard overlay to the averages + i18n the checkbox

**Files:**
- Modify: `frontend/src/pages/Dashboard/index.tsx` (imports; `recurringQ` block lines ~116–153; checkbox JSX lines ~245–256)
- Modify: `frontend/src/locales/fr/dashboard.json`, `frontend/src/locales/en/dashboard.json`
- Test: full frontend suite (wiring is thin glue over the pure functions tested in Tasks 1–3; the repo has no `Dashboard/index` component test and this plan doesn't add one)

**Interfaces:**
- Consumes: `projectAverageBalance` + `monthlyFlowAverages` (Task 1–2, from `../../lib/average-forecast`), `computeMonthlyStats` (Task 3, from `./monthly-stats`), `AVG_WINDOW_MONTHS` / `monthAgoISODate` / `lastDayOfPrevMonthISODate` (existing, from `./helpers`), `CategoryReportRow` (existing, from `../../api/types`).
- Produces: nothing consumed later.

- [ ] **Step 1: Add the i18n keys**

In `frontend/src/locales/fr/dashboard.json`, after the `"sections"` object, add:

```json
"forecast": {
  "label": "Voir la projection",
  "tooltip": "Prolonge la courbe avec une projection en pointillé basée sur vos moyennes mensuelles de revenus et de dépenses."
},
```

In `frontend/src/locales/en/dashboard.json`, same position:

```json
"forecast": {
  "label": "Show projection",
  "tooltip": "Extends the curve with a dashed projection based on your average monthly income and spending."
},
```

- [ ] **Step 2: Swap the forecast wiring in `pages/Dashboard/index.tsx`**

Imports — remove:

```ts
import { projectBalance } from '../../lib/recurring-forecast';
import type { RecurringSeries } from '../../api/types';
```

and add (`BalancePoint`/`BalanceCheckpoint` already come from `../../api/types`; extend that line for `CategoryReportRow`):

```ts
import type { Account, BalancePoint, BalanceCheckpoint, CategoryReportRow } from '../../api/types';
import { projectAverageBalance, monthlyFlowAverages } from '../../lib/average-forecast';
import { computeMonthlyStats } from './monthly-stats';
import { AVG_WINDOW_MONTHS, monthAgoISODate, lastDayOfPrevMonthISODate } from './helpers';
```

Replace the `recurringQ` query and the `forecastProjection` memo (currently lines 116–153, from the `// Recurring series drive the optional forecast overlay…` comment through the end of the memo) with:

```ts
  // The optional forecast overlay extrapolates historical AVERAGES instead
  // of replaying confirmed recurring series — users confirm their income
  // series but few outflows, which made the old projection staircase upward
  // while the real balance stayed flat. Same query key as
  // MoyennesMensuellesSection, so React Query dedupes: tiles and projection
  // always show the same averages.
  const statsFromDate = monthAgoISODate(AVG_WINDOW_MONTHS);
  const statsToDate = lastDayOfPrevMonthISODate();
  const statsQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate: statsFromDate, toDate: statsToDate }],
    queryFn: () =>
      api<{ rows: CategoryReportRow[] }>('/api/reports/categories', {
        query: { fromDate: statsFromDate, toDate: statsToDate },
      }),
    enabled: settings.showForecast,
  });

  const forecastProjection = useMemo(() => {
    if (!settings.showForecast) return undefined;
    const today = new Date().toISOString().slice(0, 10);
    // Anchor the projection to today's total for the current scope.
    let startBalance: number;
    let avgMonthlyIncome: number;
    let avgMonthlySpend: number;
    if (chartScope === 'all') {
      startBalance = Number(
        balanceQ.data?.perCurrency?.find((c) => c.currency === chartCurrency)?.total ?? 0,
      );
      const stats = computeMonthlyStats(statsQ.data?.rows ?? []);
      if (stats.monthCount === 0) return undefined;
      avgMonthlyIncome = stats.avgIncome;
      avgMonthlySpend = -stats.avgSpend; // signed → positive magnitude
    } else {
      // Single account: internal transfers move its balance, so derive the
      // averages from its own balance deltas rather than the transfer-free
      // category report. Full history — chartPoints is range-filtered.
      const acc = accounts.find((a) => a.id === chartScope);
      startBalance = Number(acc?.currentBalance ?? acc?.openingBalance ?? 0);
      const scoped = (seriesQ.data?.points ?? []).filter((p) => p.account_id === chartScope);
      const flows = monthlyFlowAverages(scoped, today);
      if (!flows) return undefined;
      avgMonthlyIncome = flows.avgIncome;
      avgMonthlySpend = flows.avgSpend;
    }
    // Cap at 180 days ahead so the overlay stays bounded regardless of
    // how the range picker was set.
    const HORIZON = 180;
    // Drop index 0 (today) — the historical line already ends there.
    return projectAverageBalance({
      startBalance,
      avgMonthlyIncome,
      avgMonthlySpend,
      horizonDays: HORIZON,
      startDate: today,
    }).slice(1);
  }, [settings.showForecast, statsQ.data, seriesQ.data, chartScope, chartCurrency, accounts, balanceQ.data]);
```

(The memo's output shape `{ date, value }[]` is what `BalanceChart`'s `projection` prop already takes — the render call at line ~269 doesn't change.)

- [ ] **Step 3: i18n the checkbox label and tooltip**

In the chart-header JSX (lines ~245–256), replace the hardcoded French:

```tsx
              <label
                className="flex items-center gap-1.5 text-xs text-ink-400 cursor-pointer select-none"
                title={t('forecast.tooltip')}
              >
                <input
                  type="checkbox"
                  checked={settings.showForecast}
                  onChange={(e) => patchSettings({ showForecast: e.target.checked })}
                  className="accent-sage-500"
                />
                {t('forecast.label')}
              </label>
```

- [ ] **Step 4: Run the full frontend suite and lint**

Run: `npx vitest run`
Expected: PASS — including the i18n smoke test (key parity) and `Transactions.test.tsx` (its `showForecast` reference is a settings fixture, unaffected).

Run: `npx eslint src/pages/Dashboard/index.tsx src/lib/average-forecast.ts src/pages/Dashboard/monthly-stats.ts src/pages/Dashboard/MoyennesMensuellesSection.tsx`
Expected: clean — in particular no `max-lines` error on `index.tsx` (the diff is roughly size-neutral) and no unused-import warnings (`projectBalance`, `RecurringSeries` gone).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard/index.tsx src/locales/fr/dashboard.json src/locales/en/dashboard.json
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com commit -m "feat(dashboard): base the projection overlay on monthly averages

The recurring-series projection counted confirmed income but almost no
outflows, so it staircased to +15k while the real balance trend was flat.
The overlay now extrapolates a sawtooth from historical averages: the
Moyennes mensuelles numbers for the all-accounts scope, the account's own
balance-delta flows for a single account.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Final verification sweep

**Files:** none new — verification only.

- [ ] **Step 1: Full frontend suite from a clean state**

Run: `npx vitest run`
Expected: PASS, zero failures.

- [ ] **Step 2: TypeScript build check**

Run: `npx tsc -b` (the compile half of the repo's `build` script: `tsc -b && vite build`)
Expected: no type errors.

- [ ] **Step 3: Confirm nothing else imports the removed wiring**

Run: `grep -rn "recurringQ" src/` — expected: no matches.
Run: `grep -rn "recurring-forecast" src/ | grep -v __tests__` — expected: only `pages/Recurrent/` consumers (the Prévision tab keeps working) and `lib/recurring-forecast.ts` itself.

- [ ] **Step 4: Report**

Do NOT push. Summarize the commits and remind the user that pushing is manual.
