export type RangeKey = '30d' | '3m' | '6m' | '12m' | 'all';

interface RangeSpec { key: RangeKey; label: string; days: number | null }

// Days = null → "all time" (no lower bound). Kept as the source of truth for
// every consumer, so the label ("3 m") and the lookup window (~90 days) can
// never drift apart.
export const RANGES: readonly RangeSpec[] = [
  { key: '30d', label: '30 j',  days: 30  },
  { key: '3m',  label: '3 m',   days: 90  },
  { key: '6m',  label: '6 m',   days: 180 },
  { key: '12m', label: '12 m',  days: 365 },
  { key: 'all', label: 'Tout',  days: null },
] as const;

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

/** Short human label for the "sur X" affordance ("sur 30 j" / "depuis l'ouverture"). */
export function rangeSuffixLabel(range: RangeKey): string {
  switch (range) {
    case '30d': return 'sur 30 jours';
    case '3m':  return 'sur 3 mois';
    case '6m':  return 'sur 6 mois';
    case '12m': return 'sur 12 mois';
    case 'all': return "depuis l'ouverture";
  }
}

interface Props {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
  /** Optional aria-label for the wrapping group. */
  ariaLabel?: string;
}

export function RangePicker({ value, onChange, ariaLabel = 'Période affichée' }: Props): JSX.Element {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
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
          {r.label}
        </button>
      ))}
    </div>
  );
}
