import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export type RangeKey = '30d' | '3m' | '6m' | '12m' | 'all';

interface RangeSpec { key: RangeKey; days: number | null }

// Days = null → "all time" (no lower bound). Kept as the source of truth for
// the lookup window (~90 days) so it never drifts from the range key. The
// display label and "sur X" suffix are translated — see rangeLabel() /
// rangeSuffixLabel() below — keyed off `charts.rangePicker` using a
// translation-key-safe id (RANGES[i].key with the leading digit dropped,
// e.g. '30d' -> 'd30') since i18next keys can't start with a digit.
export const RANGES: readonly RangeSpec[] = [
  { key: '30d', days: 30  },
  { key: '3m',  days: 90  },
  { key: '6m',  days: 180 },
  { key: '12m', days: 365 },
  { key: 'all', days: null },
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

/** ISO YYYY-MM-DD lower bound for a range key, or undefined for 'all'. */
export function fromDateFor(range: RangeKey): string | undefined {
  const r = RANGES.find((x) => x.key === range);
  if (!r || r.days === null) return undefined;
  return todayMinusDays(r.days);
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
