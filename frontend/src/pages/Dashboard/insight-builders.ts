import type { TFunction } from 'i18next';
import type { BudgetReportRow } from '../../api/types';
import { formatAmount } from '../../lib/format';
import type { Insight, InsightLang, InsightTone } from './insight-types';
import { monthLabel } from './insights';

// Thresholds mirror the originals in insights.ts — the extracted builders
// share them so behavior is identical to the pre-split version.
export const DELTA_PCT_MIN = 10;
export const SAVINGS_DEV_MIN = 10;
export const MOVER_ABS_MIN = 50;
export const MOVER_PCT_MIN = 30;

// "+18,0 %" / "-3,5 %". Positive gets an explicit '+'; negatives already
// carry '-' from toFixed. Intentionally not locale-aware — mirrors
// formatAmount, which is still hardcoded to fr-FR pending the number-
// formatting cleanup pass.
export function signedPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1).replace('.', ',')} %`;
}

// "+150,00 €" / "-80,00 €".
export function signedAmount(v: number, currency: string): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${formatAmount(v, currency)}`;
}

// sage when the movement is favourable, clay when not, neutral at zero.
export function tone(favorableWhenUp: boolean, delta: number): InsightTone {
  if (delta === 0) return 'neutral';
  const favorable = favorableWhenUp ? delta > 0 : delta < 0;
  return favorable ? 'sage' : 'clay';
}

export function spendDeltaInsight(args: {
  curSpend: number; prevSpend: number; avgSpend: number;
  referenceMonth: string; prevMonth: string; currency: string;
  spark: number[]; t: TFunction; lang: InsightLang;
}): Insight | null {
  const { curSpend, prevSpend, avgSpend, referenceMonth, prevMonth, currency, spark, t, lang } = args;
  if (prevSpend <= 0) return null;
  const pct = ((curSpend - prevSpend) / prevSpend) * 100;
  if (Math.abs(pct) < DELTA_PCT_MIN) return null;
  let detail = t('insights.spendDelta.detail', { pct: signedPct(pct), month: monthLabel(prevMonth, lang) });
  if (avgSpend > 0 && Math.abs((curSpend - avgSpend) / avgSpend) * 100 >= DELTA_PCT_MIN) {
    detail += curSpend > avgSpend ? t('insights.spendDelta.aboveAverage') : t('insights.spendDelta.belowAverage');
  }
  return {
    key: 'spend-delta', icon: pct > 0 ? '📈' : '📉',
    headline: t('insights.spendDelta.headline', { month: monthLabel(referenceMonth, lang), amount: formatAmount(curSpend, currency) }),
    detail, tone: tone(false, curSpend - prevSpend), score: Math.abs(pct), spark,
  };
}

export function incomeDeltaInsight(args: {
  curIncome: number; prevIncome: number;
  referenceMonth: string; prevMonth: string; currency: string;
  spark: number[]; t: TFunction; lang: InsightLang;
}): Insight | null {
  const { curIncome, prevIncome, referenceMonth, prevMonth, currency, spark, t, lang } = args;
  if (prevIncome <= 0) return null;
  const pct = ((curIncome - prevIncome) / prevIncome) * 100;
  if (Math.abs(pct) < DELTA_PCT_MIN) return null;
  return {
    key: 'income-delta', icon: pct > 0 ? '📈' : '📉',
    headline: t('insights.incomeDelta.headline', { month: monthLabel(referenceMonth, lang), amount: formatAmount(curIncome, currency) }),
    detail: t('insights.incomeDelta.detail', { pct: signedPct(pct), month: monthLabel(prevMonth, lang) }),
    tone: tone(true, curIncome - prevIncome), score: Math.abs(pct), spark,
  };
}

export function savingsInsight(args: {
  income: number; spend: number; avgIncome: number; avgSpend: number;
  referenceMonth: string; currency: string; t: TFunction; lang: InsightLang;
}): Insight | null {
  const { income, spend, avgIncome, avgSpend, referenceMonth, currency, t, lang } = args;
  const savings = income - spend;
  if (savings < 0) {
    return {
      key: 'savings', icon: '⚠️',
      headline: t('insights.overspent.headline', { month: monthLabel(referenceMonth, lang) }),
      detail: t('insights.overspent.detail', { amount: formatAmount(savings, currency) }),
      tone: 'clay', score: 100,
    };
  }
  if (income <= 0) return null;
  const rate = (savings / income) * 100;
  const avgSavings = avgIncome - avgSpend;
  const avgRate = avgIncome > 0 ? (avgSavings / avgIncome) * 100 : 0;
  const dev = Math.abs(rate - avgRate);
  if (dev < SAVINGS_DEV_MIN) return null;
  return {
    key: 'savings', icon: '🐷',
    headline: t('insights.savingsRate.headline', { amount: formatAmount(savings, currency), month: monthLabel(referenceMonth, lang), rate: Math.round(rate) }),
    detail: rate > avgRate ? t('insights.savingsRate.aboveUsual') : t('insights.savingsRate.belowUsual'),
    tone: tone(true, rate - avgRate), score: dev,
  };
}

export function categoryMoversInsights(args: {
  catSpend: Map<number | null, { name: string; spark: number[] }>;
  refIdx: number; prevIdx: number; prevMonth: string; currency: string;
  t: TFunction; lang: InsightLang;
}): Insight[] {
  const { catSpend, refIdx, prevIdx, prevMonth, currency, t, lang } = args;
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
  const out: Insight[] = [];
  if (topInc) {
    out.push({
      key: 'top-increase', icon: '🔺',
      headline: t('insights.topIncrease.headline', { category: topInc.name }),
      detail: topInc.fromZero
        ? t('insights.topIncrease.new')
        : t('insights.topIncrease.detail', { amount: signedAmount(topInc.d, currency), pct: signedPct(topInc.pct), month: monthLabel(prevMonth, lang) }),
      tone: 'clay', score: Math.min(Math.abs(topInc.pct), 100),
    });
  }
  if (topDec) {
    out.push({
      key: 'top-decrease', icon: '🔻',
      headline: t('insights.topDecrease.headline', { category: topDec.name }),
      detail: t('insights.topDecrease.detail', { amount: signedAmount(topDec.d, currency), pct: signedPct(topDec.pct), month: monthLabel(prevMonth, lang) }),
      tone: 'sage', score: Math.min(Math.abs(topDec.pct), 100),
    });
  }
  return out;
}

export function budgetOverrunsInsight(
  budgetRows: BudgetReportRow[],
  referenceMonth: string,
  t: TFunction,
  lang: InsightLang,
): Insight | null {
  const over = budgetRows.filter((r) => r.over);
  if (over.length === 0) return null;
  const names = over.map((r) => r.name);
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
  return {
    key: 'budget-overruns', icon: '⚠️',
    headline: t('insights.budgetOverruns.headline', { count: over.length, month: monthLabel(referenceMonth, lang) }),
    detail: shown, tone: 'clay', score: 50 + 10 * over.length,
  };
}
