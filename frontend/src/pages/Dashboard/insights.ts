import type { TFunction } from 'i18next';
import type { Category, CategoryReportRow, BudgetReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';

export type InsightTone = 'sage' | 'clay' | 'neutral';
export type InsightLang = 'en' | 'fr';

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

// Calendar month name, localized via Intl (not a translation-file lookup —
// there's no "vocabulary" to maintain, just the standard CLDR month names).
export function monthLabel(key: string, lang: InsightLang = 'fr'): string {
  const [year, month] = key.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'fr-FR', {
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
}

// "+18,0 %" / "-3,5 %". Positive gets an explicit '+'; negatives already
// carry '-' from toFixed. Never called with a non-finite value.
// NOTE: intentionally NOT locale-aware — mirrors `formatAmount`, which is
// still hardcoded to fr-FR pending Task 11's number-formatting cleanup pass.
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
      // Revenue counts income-kind categories only. A positive amount sitting
      // in an expense/neutral/uncategorised row (a refund, a reimbursement) is
      // NOT revenue and must not inflate "Vos revenus" or the savings figure.
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

  // Averages are trailing: only months up to and including the reference month
  // count, so stepping back to an earlier month never averages in months that
  // come after the one being viewed.
  const trailing = refIdx >= 0 ? refIdx + 1 : months.length;
  const activeCount =
    months.slice(0, trailing).filter((_, i) => spendByMonth[i] > 0 || incomeByMonth[i] > 0)
      .length || 1;
  const avgSpend = spendByMonth.slice(0, trailing).reduce((a, b) => a + b, 0) / activeCount;
  const avgIncome = incomeByMonth.slice(0, trailing).reduce((a, b) => a + b, 0) / activeCount;

  const sparkOf = (arr: number[]) => arr.slice(Math.max(0, refIdx - 5), refIdx + 1);

  const insights: Insight[] = [];

  if (refIdx >= 0 && prevMonth !== null) {
    // spend-delta
    const curSpend = spendByMonth[refIdx];
    const prevSpend = spendByMonth[prevIdx];
    if (prevSpend > 0) {
      const pct = ((curSpend - prevSpend) / prevSpend) * 100;
      if (Math.abs(pct) >= DELTA_PCT_MIN) {
        let detail = t('insights.spendDelta.detail', {
          pct: signedPct(pct),
          month: monthLabel(prevMonth, lang),
        });
        if (avgSpend > 0 && Math.abs((curSpend - avgSpend) / avgSpend) * 100 >= DELTA_PCT_MIN) {
          detail += curSpend > avgSpend
            ? t('insights.spendDelta.aboveAverage')
            : t('insights.spendDelta.belowAverage');
        }
        insights.push({
          key: 'spend-delta',
          icon: pct > 0 ? '📈' : '📉',
          headline: t('insights.spendDelta.headline', {
            month: monthLabel(referenceMonth, lang),
            amount: formatAmount(curSpend, currency),
          }),
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
          headline: t('insights.incomeDelta.headline', {
            month: monthLabel(referenceMonth, lang),
            amount: formatAmount(curIncome, currency),
          }),
          detail: t('insights.incomeDelta.detail', {
            pct: signedPct(pct),
            month: monthLabel(prevMonth, lang),
          }),
          tone: tone(true, curIncome - prevIncome),
          score: Math.abs(pct),
          spark: sparkOf(incomeByMonth),
        });
      }
    }

    // savings
    const income = incomeByMonth[refIdx];
    const spend = spendByMonth[refIdx];
    const savings = income - spend;
    if (savings < 0) {
      insights.push({
        key: 'savings',
        icon: '⚠️',
        headline: t('insights.overspent.headline', { month: monthLabel(referenceMonth, lang) }),
        detail: t('insights.overspent.detail', { amount: formatAmount(savings, currency) }),
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
          headline: t('insights.savingsRate.headline', {
            amount: formatAmount(savings, currency),
            month: monthLabel(referenceMonth, lang),
            rate: Math.round(rate),
          }),
          detail: rate > avgRate
            ? t('insights.savingsRate.aboveUsual')
            : t('insights.savingsRate.belowUsual'),
          tone: tone(true, rate - avgRate),
          score: dev,
        });
      }
    }

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
        headline: t('insights.topIncrease.headline', { category: topInc.name }),
        detail: topInc.fromZero
          ? t('insights.topIncrease.new')
          : t('insights.topIncrease.detail', {
              amount: signedAmount(topInc.d, currency),
              pct: signedPct(topInc.pct),
              month: monthLabel(prevMonth, lang),
            }),
        tone: 'clay',
        score: Math.min(Math.abs(topInc.pct), 100),
      });
    }
    if (topDec) {
      insights.push({
        key: 'top-decrease',
        icon: '🔻',
        headline: t('insights.topDecrease.headline', { category: topDec.name }),
        detail: t('insights.topDecrease.detail', {
          amount: signedAmount(topDec.d, currency),
          pct: signedPct(topDec.pct),
          month: monthLabel(prevMonth, lang),
        }),
        tone: 'sage',
        score: Math.min(Math.abs(topDec.pct), 100),
      });
    }
  }

  // budget overruns (independent of the prior month)
  const over = budgetRows.filter((r) => r.over);
  if (over.length > 0) {
    const names = over.map((r) => r.name);
    const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
    insights.push({
      key: 'budget-overruns',
      icon: '⚠️',
      headline: t('insights.budgetOverruns.headline', {
        count: over.length,
        month: monthLabel(referenceMonth, lang),
      }),
      detail: shown,
      tone: 'clay',
      score: 50 + 10 * over.length,
    });
  }

  insights.sort((a, b) => b.score - a.score); // stable: equal scores keep catalog (push) order
  return insights.slice(0, TOP_N);
}
