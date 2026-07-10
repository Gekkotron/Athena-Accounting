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
