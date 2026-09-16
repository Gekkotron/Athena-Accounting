import type { TFunction } from 'i18next';
import type { Category, CategoryReportRow, BudgetReportRow, RecurringSeries } from '../../api/types';
import { formatAmount } from '../../lib/format';
import type { Insight, InsightLang } from './insight-types';
import {
  spendDeltaInsight,
  incomeDeltaInsight,
  savingsInsight,
  categoryMoversInsights,
  budgetOverrunsInsight,
} from './insight-builders';

export type { Insight, InsightLang, InsightTone } from './insight-types';

// One card summarizing the recurring series whose latest amount rose past
// the creep thresholds (server-computed priceCreep, deltaPct > 0). Dismissed
// series are ignored; magnitude decreases stay on the Récurrent page's
// per-row chips only. Kept out of buildInsights so the TOP_N score cap
// never swallows it.
export function priceCreepInsight(
  recurring: readonly RecurringSeries[],
  t: TFunction,
): Insight | null {
  // Expense-direction series only: detectPriceCreep is magnitude-based, so
  // an income series (salary) growing also reports deltaPct > 0 — good
  // news, and certainly not an "abonnement" getting pricier.
  const creeping = recurring.filter(
    (s) => s.status !== 'dismissed' && Number(s.avgAmount) < 0
      && s.priceCreep && s.priceCreep.deltaPct > 0,
  );
  if (creeping.length === 0) return null;
  const top = creeping.reduce((a, b) => b.priceCreep!.deltaPct > a.priceCreep!.deltaPct ? b : a);
  const c = top.priceCreep!;
  return {
    key: 'price-creep', icon: '💸',
    headline: t('insights.priceCreep', { count: creeping.length }),
    detail: `${top.label} : ${formatAmount(Math.abs(c.previousAvg))} → ${formatAmount(Math.abs(c.latest))} (+${Math.abs(Math.round(c.deltaPct))} %)`,
    tone: 'clay', score: 0, to: '/recurring/detected',
  };
}

const TOP_N = 4;

// Calendar month name, localized via Intl (not a translation-file lookup —
// there's no "vocabulary" to maintain, just the standard CLDR month names).
export function monthLabel(key: string, lang: InsightLang = 'fr'): string {
  const [year, month] = key.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'fr-FR', {
    month: 'long', timeZone: 'UTC',
  }).format(date);
}

// Walks the parentId chain to the top-most ancestor. Cycle-guarded: if a
// parentId loop somehow exists, the walk stops instead of looping forever.
// A category missing from `byId` (or with no parent) is its own root.
function rootIdOf(catId: number, byId: Map<number, Category>): number {
  const seen = new Set<number>();
  let cur = byId.get(catId);
  while (cur && cur.parentId != null && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId)!;
  }
  return cur ? cur.id : catId;
}

export function buildInsights(
  categoryRows: CategoryReportRow[],
  categories: Category[],
  budgetRows: BudgetReportRow[],
  months: string[],
  referenceMonth: string,
  currency: string,
  t: TFunction,
  lang: InsightLang = 'fr',
): Insight[] {
  const idxOf = new Map(months.map((m, i) => [m, i] as const));
  const refIdx = idxOf.get(referenceMonth) ?? -1;
  const prevIdx = refIdx - 1;
  const prevMonth = prevIdx >= 0 ? months[prevIdx] : null;
  const byId = new Map(categories.map((c) => [c.id, c] as const));

  const spendByMonth = new Array(months.length).fill(0) as number[];
  const incomeByMonth = new Array(months.length).fill(0) as number[];
  // Keyed by root category id (a flat category is its own root), so the
  // top-mover ranking below rolls leaf spending up to its ancestor.
  const catSpend = new Map<number | null, { name: string; spark: number[] }>();

  for (const r of categoryRows) {
    if (r.category_is_internal_transfer) continue;
    const amt = Number(r.total);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const i = idxOf.get(r.month);
    if (i === undefined) continue;
    if (r.category_kind === 'income') {
      // Revenue counts income-kind categories only. A positive amount in an
      // expense/neutral/uncategorised row (refund, reimbursement) is NOT
      // revenue and must not inflate "Vos revenus" or the savings figure.
      incomeByMonth[i] += amt;
    } else if (amt < 0) {
      spendByMonth[i] += -amt;
      const rootId = r.category_id != null ? rootIdOf(r.category_id, byId) : r.category_id;
      let c = catSpend.get(rootId);
      if (!c) {
        const rootName = rootId != null ? byId.get(rootId)?.name : null;
        c = { name: rootName ?? r.category_name ?? t('insights.uncategorized'), spark: new Array(months.length).fill(0) };
        catSpend.set(rootId, c);
      }
      c.spark[i] += -amt;
    }
  }

  // Averages are trailing: only months up to and including the reference
  // month count, so stepping back to an earlier month never averages in
  // months that come after the one being viewed.
  const trailing = refIdx >= 0 ? refIdx + 1 : months.length;
  const activeCount =
    months.slice(0, trailing).filter((_, i) => spendByMonth[i] > 0 || incomeByMonth[i] > 0)
      .length || 1;
  const avgSpend = spendByMonth.slice(0, trailing).reduce((a, b) => a + b, 0) / activeCount;
  const avgIncome = incomeByMonth.slice(0, trailing).reduce((a, b) => a + b, 0) / activeCount;

  const sparkOf = (arr: number[]) => arr.slice(Math.max(0, refIdx - 5), refIdx + 1);

  const insights: Insight[] = [];

  if (refIdx >= 0 && prevMonth !== null) {
    const spendD = spendDeltaInsight({
      curSpend: spendByMonth[refIdx], prevSpend: spendByMonth[prevIdx],
      avgSpend, referenceMonth, prevMonth, currency,
      spark: sparkOf(spendByMonth), t, lang,
    });
    if (spendD) insights.push(spendD);

    const incomeD = incomeDeltaInsight({
      curIncome: incomeByMonth[refIdx], prevIncome: incomeByMonth[prevIdx],
      referenceMonth, prevMonth, currency,
      spark: sparkOf(incomeByMonth), t, lang,
    });
    if (incomeD) insights.push(incomeD);

    const sav = savingsInsight({
      income: incomeByMonth[refIdx], spend: spendByMonth[refIdx],
      avgIncome, avgSpend, referenceMonth, currency, t, lang,
    });
    if (sav) insights.push(sav);

    insights.push(...categoryMoversInsights({
      catSpend, refIdx, prevIdx, prevMonth, currency, t, lang,
    }));
  }

  const overruns = budgetOverrunsInsight(budgetRows, referenceMonth, t, lang);
  if (overruns) insights.push(overruns);

  insights.sort((a, b) => b.score - a.score); // stable: equal scores keep catalog order
  return insights.slice(0, TOP_N);
}
