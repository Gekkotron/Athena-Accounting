import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAmount } from '../lib/format';

export interface CategorySegment {
  id: number | null;
  name: string;
  color: string | null;
  amount: number;
}

interface Props {
  data: CategorySegment[];
  currency?: string;
  centerLabel?: string;
}

// Curated palette — colors are picked to coexist with the warm-cool charcoal
// background while still being distinguishable from each other at small sizes.
// Used as a fallback when a category has no `color` of its own.
const FALLBACK_PALETTE = [
  '#7dd3c0', // sage
  '#dc7861', // clay
  '#d4a05a', // gold
  '#7aa8d4', // sky
  '#b08fd4', // lavender
  '#97b87f', // moss
  '#d48ba8', // dusty rose
  '#6cc1bb', // teal
  '#caa97a', // sand
  '#9cb6d4', // steel blue
];

const VIEWBOX = 240;
const RADIUS = 92;
const STROKE = 22;
const CENTER = VIEWBOX / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function CategoryDonut({ data, currency = 'EUR', centerLabel }: Props) {
  const { t } = useTranslation('charts');
  const [hovered, setHovered] = useState<number | null>(null);

  const segments = useMemo(() => {
    const positive = data.filter((d) => d.amount > 0);
    const total = positive.reduce((s, d) => s + d.amount, 0);
    if (total === 0) return [];

    let cum = 0;
    const palette = [...FALLBACK_PALETTE];

    return positive
      .sort((a, b) => b.amount - a.amount)
      .map((d, i) => {
        const fraction = d.amount / total;
        const dash = fraction * CIRCUMFERENCE;
        const gap = CIRCUMFERENCE - dash;
        const offset = -cum;
        cum += dash;
        return {
          ...d,
          fraction,
          dash,
          gap,
          offset,
          color: d.color ?? palette[i % palette.length]!,
        };
      });
  }, [data]);

  const total = segments.reduce((s, d) => s + d.amount, 0);

  if (segments.length === 0) {
    return (
      <div className="text-sm text-ink-500 py-12 text-center display-italic">
        {t('categoryDonut.empty')}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 md:gap-8 items-center">
      {/* SVG donut */}
      <div className="relative mx-auto">
        <svg
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          className="block"
          style={{ width: 220, height: 220 }}
        >
          {/* background ring — very faint, gives the donut a "groove" feel */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="#161a21"
            strokeWidth={STROKE}
          />
          {/* segments — rotate -90deg so the cut starts at 12 o'clock */}
          <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
            {segments.map((s, i) => {
              const hi = hovered === null ? true : hovered === i;
              return (
                <circle
                  key={`${s.id ?? 'null'}-${i}`}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={hovered === i ? STROKE + 4 : STROKE}
                  strokeDasharray={`${s.dash} ${s.gap}`}
                  strokeDashoffset={s.offset}
                  strokeLinecap="butt"
                  opacity={hi ? 1 : 0.35}
                  style={{ transition: 'opacity 200ms, stroke-width 200ms' }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
          </g>

          {/* center label */}
          <g>
            <text
              x={CENTER}
              y={CENTER - 6}
              textAnchor="middle"
              fill="#5b6478"
              fontSize="9"
              fontFamily="Hanken Grotesk Variable, sans-serif"
              letterSpacing="1.5"
              style={{ textTransform: 'uppercase' }}
            >
              {centerLabel ?? t('categoryDonut.total')}
            </text>
            <text
              x={CENTER}
              y={CENTER + 14}
              textAnchor="middle"
              fill={hovered !== null ? segments[hovered]!.color : '#e6e8ed'}
              fontSize="22"
              fontFamily="Fraunces Variable, Georgia, serif"
              fontStyle="italic"
              style={{ transition: 'fill 200ms' }}
              className={hovered === null ? 'private' : undefined}
            >
              {hovered !== null
                ? `${Math.round(segments[hovered]!.fraction * 100)}%`
                : formatAmount(total, currency).replace(/ /g, ' ')}
            </text>
            {hovered !== null && (
              <text
                x={CENTER}
                y={CENTER + 30}
                textAnchor="middle"
                fill="#7c8493"
                fontSize="10"
                fontFamily="JetBrains Mono Variable, monospace"
                className="private"
              >
                {formatAmount(segments[hovered]!.amount, currency)}
              </text>
            )}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <ul className="flex flex-col gap-1.5 max-h-[260px] overflow-y-auto pr-1">
        {segments.map((s, i) => (
          <li
            key={`${s.id ?? 'null'}-${i}`}
            className={`group flex items-baseline gap-3 rounded-md px-2 py-1.5 text-sm transition cursor-default ${
              hovered === i ? 'bg-ink-850' : ''
            }`}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: s.color, boxShadow: `0 0 0 2px ${s.color}22` }}
            />
            <span className="flex-1 min-w-0 truncate text-ink-200">{s.name}</span>
            <span className="font-mono tabular-nums text-xs text-ink-400 shrink-0">
              {Math.round(s.fraction * 100)}%
            </span>
            <span className="font-mono tabular-nums text-xs text-ink-100 shrink-0 w-24 text-right">
              {formatAmount(s.amount, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
