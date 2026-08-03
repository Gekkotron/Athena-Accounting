import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export type RangeKey = '30d' | '3m' | '6m' | '12m' | 'all';

// `days` → trailing window of N days; `monthsBack` → calendar window starting
// on the 1st of the month N months back (the in-progress month counts as the
// last one, so "6m" = 5 complete months + the current month). Month ranges
// used to be fixed day counts (180/365), which chopped the start of the
// oldest month — a salary landing on the 1st silently vanished from the
// donut/Sankey while the Moyennes tiles still counted it. Neither field →
// "all time" (no lower bound). The display label and "sur X" suffix are
// translated — see rangeSuffixLabel() below — keyed off `charts.rangePicker`
// using a translation-key-safe id (RANGES[i].key with the leading digit
// dropped, e.g. '30d' -> 'd30') since i18next keys can't start with a digit.
interface RangeSpec { key: RangeKey; days?: number; monthsBack?: number }

export const RANGES: readonly RangeSpec[] = [
  { key: '30d', days: 30 },
  { key: '3m',  monthsBack: 2 },
  { key: '6m',  monthsBack: 5 },
  { key: '12m', monthsBack: 11 },
  { key: 'all' },
] as const;

const LABEL_KEY: Record<RangeKey, string> = {
  '30d': 'd30',
  '3m': 'm3',
  '6m': 'm6',
  '12m': 'm12',
  all: 'all',
};

function todayMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstOfMonthMinus(monthsBack: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** ISO YYYY-MM-DD lower bound for a range key, or undefined for 'all'. */
export function fromDateFor(range: RangeKey): string | undefined {
  const r = RANGES.find((x) => x.key === range);
  if (r?.monthsBack !== undefined) return firstOfMonthMinus(r.monthsBack);
  if (r?.days !== undefined) return todayMinusDays(r.days);
  return undefined;
}

/** Short human label for the "sur X" affordance ("sur 30 j" / "depuis l'ouverture").
    `t` must be bound to (or declare) the 'charts' namespace. */
export function rangeSuffixLabel(range: RangeKey, t: TFunction): string {
  return t(`rangePicker.suffix.${LABEL_KEY[range]}`, { ns: 'charts' });
}

interface Props {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
  /** Optional aria-label for the wrapping group. */
  ariaLabel?: string;
}

export function RangePicker({ value, onChange, ariaLabel }: Props): JSX.Element {
  const { t } = useTranslation('charts');
  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t('rangePicker.ariaLabel')}
      className="inline-flex rounded-lg border border-ink-800 bg-ink-900/60 p-0.5 text-xs"
    >
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onChange(r.key)}
          aria-pressed={value === r.key}
          className={`px-2.5 py-1.5 rounded-md transition font-mono ${
            value === r.key
              ? 'bg-ink-850 text-ink-100'
              : 'text-ink-400 hover:text-ink-100'
          }`}
        >
          {t(`rangePicker.labels.${LABEL_KEY[r.key]}`)}
        </button>
      ))}
    </div>
  );
}
