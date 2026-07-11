# Dashboard Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three targeted Dashboard fixes — Sankey header parity with Insights, filter block moves to top of page, Sankey node-amount contrast bumped.

**Architecture:** Three self-contained tasks. Task 1 is isolated to `Sankey.tsx`. Task 2 adds an Insights-style header (title suffix + `‹ ›` chip) to `SankeySection.tsx` and gains an `onRangeChange` prop. Task 3 moves the filter block up in `Dashboard/index.tsx` and wires the new prop.

**Tech Stack:** React 18 + TanStack Query + Tailwind 3 + Vitest.

## Global Constraints

- **No new colour, spacing, typography, or icon tokens.** Reuse existing
  `ink-*`, `sage-*`, `clay-*`, `label`, `section-rule`, and Tailwind
  sizes only.
- **Reuse `rangeSuffixLabel(range)`** from
  `frontend/src/components/RangePicker.tsx` for the Sankey header
  suffix. Do NOT invent new copy.
- **Chevron convention matches Insights.** `‹` steps to the
  next-**longer** range (`30d → 3m → 6m → 12m → all`); `›` steps to the
  next-**shorter** range. Buttons disable at each end.
- **The chip mutates the shared page `range`** via the new
  `onRangeChange` callback — not a local `SankeySection` state.
- **No backend / API / schema changes.**
- **Commit style.** `feat(dashboard): …` for user-visible additions,
  `refactor(dashboard): …` for repositioning, `feat(sankey): …` for the
  contrast bump.
- **Attribution.** Every commit uses
  `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`.
  No `Co-Authored-By` trailer.
- **Direct commits on `main`.** No branches, no push until asked.

---

## Task 1: Sankey node-amount contrast

**Files:**
- Modify: `frontend/src/components/Sankey.tsx` (node-label render block,
  the second `<text>` inside the `nodes.map((n) => …)` return)

**Interfaces:**
- Consumes: existing `hoveredKey` state and `isHi` local flag already in
  scope inside the mapping callback.
- Produces: no API change.

- [ ] **Step 1: Read the current node-label render block**

Open `frontend/src/components/Sankey.tsx` and locate the two `<text>`
elements inside `layout.nodes.map((n) => { … })` at approximately
lines 188–205. The first `<text>` renders `{n.label}` with
`fill-ink-100 text-[11px]`. The second `<text>` renders
`{formatAmount(n.amount, model.currency)}` with
`fill-ink-500 text-[10px] tabular-nums`.

- [ ] **Step 2: Edit the amount `<text>` element**

Replace the second `<text>` inside `layout.nodes.map` with:

```tsx
<text
  x={labelX}
  y={n.y + n.h / 2 + 3}
  textAnchor={anchor}
  dominantBaseline="text-before-edge"
  className={`text-[11px] tabular-nums ${
    isHi ? 'fill-ink-50' : 'fill-ink-300'
  }`}
>
  {formatAmount(n.amount, model.currency)}
</text>
```

Only two visible changes vs. the current code:
- `text-[10px]` → `text-[11px]`
- `fill-ink-500` (static) → `${isHi ? 'fill-ink-50' : 'fill-ink-300'}` (conditional)

- [ ] **Step 3: Type-check + tests**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json && npx vitest run
```
Expected: no type errors; test suite pass count unchanged (Sankey.tsx
content is not asserted by DOM tests).

- [ ] **Step 4: Manual visual smoke (optional)**

Boot the app (`npm run dev`) and confirm the amounts alongside Sankey
nodes are visibly brighter. Hover a node — the hovered node's amount
should now render at `ink-50` (brightest). If Vite isn't available in
your sandbox, skip and rely on the tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sankey.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "feat(sankey): bump node-amount contrast for readability"
```

---

## Task 2: Sankey header parity with Insights

**Files:**
- Modify: `frontend/src/pages/Dashboard/SankeySection.tsx`
- Modify: `frontend/src/pages/Dashboard/__tests__/SankeySection.test.tsx`
  (existing render call gets a new required prop; add new cases for the
  header + arrow behavior)

**Interfaces:**
- Consumes: `RangeKey`, `RANGES`, `rangeSuffixLabel` from
  `../../components/RangePicker`.
- Produces: `SankeySection` accepts a new prop:

```ts
interface Props {
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  currency: string;
}
```

- [ ] **Step 1: Update the existing test's render call**

Open
`frontend/src/pages/Dashboard/__tests__/SankeySection.test.tsx`.
Change the existing `renderSection` helper to accept an
`onRangeChange` spy and pass it through. Replace the current helper
with:

```tsx
function renderSection(opts: { range?: import('../../../components/RangePicker').RangeKey; onRangeChange?: (r: any) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRangeChange = opts.onRangeChange ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <SankeySection
        range={opts.range ?? '12m'}
        onRangeChange={onRangeChange}
        currency="EUR"
      />
    </QueryClientProvider>,
  );
  return { ...utils, onRangeChange };
}
```

Update the two existing test cases to call `renderSection()` (no args)
instead of the bare form. They should keep passing on the new signature.

- [ ] **Step 2: Add four new failing tests**

Append to
`frontend/src/pages/Dashboard/__tests__/SankeySection.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event';

it('renders the header suffix based on the range prop', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ range: '30d' });
  expect(await screen.findByText(/sur 30 jours/i)).toBeInTheDocument();
});

it('clicking the "longer range" chevron calls onRangeChange with the next-longer range', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  const { onRangeChange } = renderSection({ range: '6m' });
  const u = userEvent.setup();
  await u.click(await screen.findByRole('button', { name: /période plus longue/i }));
  expect(onRangeChange).toHaveBeenCalledWith('12m');
});

it('disables the "longer" chevron on `all`', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ range: 'all' });
  const longer = await screen.findByRole('button', { name: /période plus longue/i });
  expect(longer).toBeDisabled();
});

it('disables the "shorter" chevron on `30d`', async () => {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/api/categories') return { categories: [] } as any;
    return { rows: [] } as any;
  });
  renderSection({ range: '30d' });
  const shorter = await screen.findByRole('button', { name: /période plus courte/i });
  expect(shorter).toBeDisabled();
});
```

- [ ] **Step 3: Run tests to verify the four new cases fail**

```bash
cd frontend && npx vitest run src/pages/Dashboard/__tests__/SankeySection.test.tsx
```
Expected: the two pre-existing tests still pass (they should — the new
prop is optional-in-test-helper terms). The four new tests FAIL with
"unable to find element" (header suffix, chevron buttons).

- [ ] **Step 4: Rewrite `SankeySection.tsx`**

Replace the entire file with:

```tsx
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Category, CategoryReportRow } from '../../api/types';
import {
  RANGES,
  fromDateFor,
  rangeSuffixLabel,
  type RangeKey,
} from '../../components/RangePicker';
import { buildSankeyModel } from './sankey';
import { Sankey } from '../../components/Sankey';

interface Props {
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  currency: string;
}

export function SankeySection({ range, onRangeChange, currency }: Props): JSX.Element {
  const fromDate = fromDateFor(range);

  const catListQ = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ categories: Category[] }>('/api/categories'),
  });
  const reportQ = useQuery({
    queryKey: ['reports', 'categories', { fromDate: fromDate ?? 'all', accountId: 'all' }],
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

  // Order (short → long) matches the RangePicker segmented control.
  // `‹` steps to a LONGER range (further back in time), `›` to a SHORTER
  // one. Same directional convention as Insights' month arrows.
  const rangeIndex = RANGES.findIndex((r) => r.key === range);
  const canLonger = rangeIndex >= 0 && rangeIndex < RANGES.length - 1;
  const canShorter = rangeIndex > 0;
  const stepLonger = () => {
    if (canLonger) onRangeChange(RANGES[rangeIndex + 1]!.key);
  };
  const stepShorter = () => {
    if (canShorter) onRangeChange(RANGES[rangeIndex - 1]!.key);
  };

  return (
    <section className="surface p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="section-rule">
          Flux · {currency}{' '}
          <span className="text-ink-500 font-normal text-xs normal-case tracking-normal">
            — {rangeSuffixLabel(range)}
          </span>
        </div>
        <div className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs">
          <button
            onClick={stepLonger}
            disabled={!canLonger}
            className="px-2.5 py-1.5 rounded-md text-ink-400 transition hover:text-ink-100 disabled:opacity-30 disabled:hover:text-ink-400"
            aria-label="Période plus longue"
          >
            ‹
          </button>
          <button
            onClick={stepShorter}
            disabled={!canShorter}
            className="px-2.5 py-1.5 rounded-md text-ink-400 transition hover:text-ink-100 disabled:opacity-30 disabled:hover:text-ink-400"
            aria-label="Période plus courte"
          >
            ›
          </button>
        </div>
      </div>

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

Key details:
- The header block mirrors Insights' structure exactly (same wrapper
  classes, same chip class stack, same button class stack).
- Suffix text comes from `rangeSuffixLabel(range)` — no new copy.
- The `‹` button's `aria-label` is `"Période plus longue"`, and `›` is
  `"Période plus courte"`. Tests key off these strings.
- The old `<div className="section-rule mb-4">Flux · {currency}</div>`
  is replaced by the flex row.

- [ ] **Step 5: Run all frontend tests**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json && npx vitest run
```
Expected: **all pass**, including the four new SankeySection cases.

If a Dashboard-level test breaks because of the new required
`onRangeChange` prop, note the failure and STOP — Task 3 wires the
callback at the Dashboard call site, but the type error surfaces here.
In practice, `Dashboard/index.tsx` today renders
`<SankeySection range={range} currency={…} />` without the new prop,
which fails TypeScript. To keep Task 2 shippable on its own, DO make
the wiring change in `Dashboard/index.tsx` here as well (a one-line
addition: `onRangeChange={setRange}`). Task 3 then only moves the
filter block.

- [ ] **Step 6: Add the one-line wiring in `Dashboard/index.tsx`**

Locate the line (around 168):

```tsx
<SankeySection range={range} currency={primary?.currency ?? chartCurrency} />
```

Change to:

```tsx
<SankeySection
  range={range}
  onRangeChange={setRange}
  currency={primary?.currency ?? chartCurrency}
/>
```

- [ ] **Step 7: Type-check + tests again**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json && npx vitest run
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/Dashboard/SankeySection.tsx \
        frontend/src/pages/Dashboard/__tests__/SankeySection.test.tsx \
        frontend/src/pages/Dashboard/index.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "feat(dashboard): sankey header parity with insights (suffix + arrow chip)"
```

---

## Task 3: Move filter block to top of Dashboard

**Files:**
- Modify: `frontend/src/pages/Dashboard/index.tsx`

**Interfaces:**
- Consumes: no new props.
- Produces: no API change. This is a pure JSX reorder.

- [ ] **Step 1: Read the current Dashboard JSX**

Open `frontend/src/pages/Dashboard/index.tsx`. The current section
order inside the returned `<div className="flex flex-col gap-10">` is:

1. `<DashboardHero primary={primary} />`
2. Other-currencies strip (guarded by `currencies.length > 1`)
3. `<MoyennesMensuellesSection />` (guarded by `primary`)
4. `<InsightsSection />` (guarded by `primary`)
5. **Filter block** — the `<section className="surface p-4 md:p-5 flex flex-col gap-3">` (guarded by `currencies.length > 0`)
6. Time series `<section>` — "Évolution"
7. Category donut `<section>` — "Répartition"
8. `<SankeySection />`

- [ ] **Step 2: Reorder the JSX**

Move the filter block (item 5) to sit **between item 2
(other-currencies strip) and item 3 (`MoyennesMensuellesSection`)**.
The new order:

1. `<DashboardHero />`
2. Other-currencies strip
3. **Filter block** ← moved
4. `<MoyennesMensuellesSection />`
5. `<InsightsSection />`
6. Évolution
7. Répartition
8. `<SankeySection />`

Cut the filter block block verbatim (about 22 lines starting with the
`{currencies.length > 0 && (\n    <section className="surface p-4
md:p-5 flex flex-col gap-3">` comment/section) and paste it above the
`{primary && <MoyennesMensuellesSection …/>}` line. Do not modify the
block's internal markup.

The final JSX skeleton reads:

```tsx
return (
  <div className="flex flex-col gap-10">
    <DashboardHero primary={primary} />

    {/* Other currencies */}
    {currencies.length > 1 && (
      <section className="flex flex-wrap gap-3">
        {/* … unchanged … */}
      </section>
    )}

    {/* Dashboard filters — account scope drives the balance chart; range
        drives the balance chart, the donut and the Sankey. Local changes
        stay in this session only; the persistent defaults live in Réglages. */}
    {currencies.length > 0 && (
      <section className="surface p-4 md:p-5 flex flex-col gap-3">
        <select /* … unchanged … */ />
        <div className="flex">
          <RangePicker value={range} onChange={setRange} />
        </div>
      </section>
    )}

    {primary && <MoyennesMensuellesSection currency={primary.currency} />}
    {primary && <InsightsSection currency={primary.currency} />}

    {/* Time series */}
    {currencies.length > 0 && (
      <section className="surface p-5 md:p-6">
        <div className="section-rule mb-4">Évolution · {chartCurrency}</div>
        {/* … unchanged … */}
      </section>
    )}

    {/* Category breakdown — donut */}
    {currencies.length > 0 && (
      <section className="surface p-5 md:p-6">
        <div className="section-rule mb-4">Répartition par catégorie</div>
        <CategoryBreakdown /* … unchanged … */ />
      </section>
    )}

    {/* Cash-flow Sankey — follows the page range */}
    {currencies.length > 0 && (
      <SankeySection
        range={range}
        onRangeChange={setRange}
        currency={primary?.currency ?? chartCurrency}
      />
    )}
  </div>
);
```

Also update the filter block's comment: the copy `range drives the
balance chart and the donut` should become `range drives the balance
chart, the donut and the Sankey.` — the Sankey is now visibly driven
by the same range and the outdated comment misleads a future reader.

- [ ] **Step 3: Type-check + tests**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json && npx vitest run
```
Expected: all pass. No new tests needed for this task — the reorder
doesn't change behavior, and no existing test asserts on the DOM
position of the filter block.

- [ ] **Step 4: Manual smoke (optional)**

Boot the app; confirm the filter block sits right after the Hero, and
that changing the range or account still updates Évolution,
Répartition, and Sankey.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard/index.tsx
git -c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com \
    commit -m "refactor(dashboard): move page filter block to sit right after the hero"
```

---

## Notes for the executor

- **Work directly on `main`.** No branches. Do not push unless the user
  explicitly asks.
- **Attribution** on every commit: `-c user.name=Gekkotron -c user.email=60887050+Gekkotron@users.noreply.github.com`.
  Do not update `.git/config`. Do NOT include a `Co-Authored-By` trailer.
- **Do not touch unrelated modified files** — `.gitignore`, `TODO.md`,
  `docs/standalone-app-distribution.md` may show up in `git status`;
  leave them alone.
- **If a test unrelated to this plan fails**, stop and report — do not
  fix it here.
