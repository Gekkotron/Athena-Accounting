import { consolidate } from '../../../domain/fx/consolidate.js';
import { resolveRate } from '../../../domain/fx/resolve-rate.js';
import type { FxRate } from '../../../domain/fx/types.js';

export type BudgetConsolidateRow = {
  currency: string;
  limit: string;
  spent: string;
  remaining: string;
  projected: string | null;
};

export type BudgetConsolidatedBlock = {
  display: string;
  totals: {
    limit: string;
    spent: string;
    remaining: string;
    projected: string | null;
  };
  unmapped: BudgetConsolidateRow[];
};

const BUDGET_CONSOLIDATE_KEYS = ['limit', 'spent', 'remaining'] as const;

// Half-up rounding to 2 decimals, matching the formula used across the FX
// consolidation code (domain/fx/consolidate.ts keeps its own copy too — it's
// small enough that duplicating beats exporting a "private" helper).
function quantize2(n: number): string {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}

// Groups the budget response's rows by currency, sums their numeric fields,
// then converts the per-currency sums into `display` via the manual FX
// table. `projected` is handled outside consolidate(): a null projected on
// any row in a currency (too early in the period to extrapolate) poisons
// that currency's projected sum, and any currency with a null or unmapped
// (no applicable rate) projected sum poisons the consolidated total too.
export function buildBudgetConsolidatedBlock(
  rows: Array<{ currency: string; limit: string; spent: string; remaining: string; projected: string | null }>,
  display: string,
  rates: FxRate[],
  at: string,
): BudgetConsolidatedBlock {
  type PerCurrencyAgg = { currency: string; limit: string; spent: string; remaining: string; projected: number | null };

  const byCurrency = new Map<string, { limit: number; spent: number; remaining: number; projected: number | null }>();
  for (const r of rows) {
    let g = byCurrency.get(r.currency);
    if (!g) {
      g = { limit: 0, spent: 0, remaining: 0, projected: 0 };
      byCurrency.set(r.currency, g);
    }
    g.limit += Number(r.limit);
    g.spent += Number(r.spent);
    g.remaining += Number(r.remaining);
    if (g.projected !== null) {
      if (r.projected == null) g.projected = null;
      else g.projected += Number(r.projected);
    }
  }

  const perCurrency: PerCurrencyAgg[] = Array.from(byCurrency.entries()).map(([currency, g]) => ({
    currency,
    limit: g.limit.toFixed(2),
    spent: g.spent.toFixed(2),
    remaining: g.remaining.toFixed(2),
    projected: g.projected,
  }));

  const out = consolidate(perCurrency, display, rates, at, BUDGET_CONSOLIDATE_KEYS);
  // consolidate() pushes back the exact row objects it received for any
  // currency it couldn't map — its generic signature only names the
  // `{ currency } & Record<K, string>` fields it operates on, but each
  // element is still the original PerCurrencyAgg (projected included).
  const unmappedRows = out.unmapped as PerCurrencyAgg[];

  const anyNullProjected = perCurrency.some((p) => p.projected == null);
  let projectedTotal: string | null = null;
  if (unmappedRows.length === 0 && !anyNullProjected) {
    let sum = 0;
    for (const p of perCurrency) {
      const rate = resolveRate(rates, p.currency, display, at);
      // Guaranteed non-null: this currency wasn't pushed into `unmapped`.
      sum += (p.projected as number) * (rate as number);
    }
    projectedTotal = quantize2(sum);
  }

  return {
    display: out.display,
    totals: {
      limit: out.totals.limit,
      spent: out.totals.spent,
      remaining: out.totals.remaining,
      projected: projectedTotal,
    },
    unmapped: unmappedRows.map((u) => ({
      currency: u.currency,
      limit: u.limit,
      spent: u.spent,
      remaining: u.remaining,
      projected: u.projected == null ? null : u.projected.toFixed(2),
    })),
  };
}
