import { useMemo } from 'react';
import { layoutSankey, type SankeyModel, type LaidOutNode } from '../pages/Dashboard/sankey';
import { formatAmount } from '../lib/format';

const VIEW_W = 720;
const VIEW_H = 360;

// Accent colors mirror tailwind.config.js's "primary positive" (sage-300) and
// "primary negative" (clay-400) tones — the same shades CategoryDonut's
// fallback palette uses. Untoned nodes (e.g. "Autres") fall back to a neutral
// ink shade; category nodes use their own `color` from the data.
const SAGE = '#7dd3c0';
const CLAY = '#dc7861';
const INK_NEUTRAL = '#5b6478';

function resolveColor(n: { tone: LaidOutNode['tone']; color: string | null }): string {
  if (n.tone === 'sage') return SAGE;
  if (n.tone === 'clay') return CLAY;
  return n.color ?? INK_NEUTRAL;
}

export function Sankey({ model }: { model: SankeyModel }): JSX.Element {
  const layout = useMemo(
    () => layoutSankey(model, { width: VIEW_W, height: VIEW_H }),
    [model],
  );

  const nodesByKey = useMemo(
    () => new Map(layout.nodes.map((n) => [n.key, n])),
    [layout.nodes],
  );

  const ariaLabel =
    `Flux : ${formatAmount(model.totalIncome, model.currency)} de revenus, ` +
    `${formatAmount(model.totalExpense, model.currency)} de dépenses`;

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H + 40}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full min-w-[520px]"
      >
        {/* ribbons first so nodes/labels sit on top */}
        <g fill="none">
          {layout.links.map((l) => {
            const accentKey = l.sourceKey !== 'pool' ? l.sourceKey : l.targetKey;
            const accent = nodesByKey.get(accentKey);
            const stroke = accent ? resolveColor(accent) : INK_NEUTRAL;
            return (
              <path
                key={l.key}
                d={l.path}
                stroke={stroke}
                strokeWidth={l.width}
                strokeOpacity={0.28}
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((n) => (
            <g key={n.key}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={2} fill={resolveColor(n)} />
              <text
                x={n.column === 'right' ? n.x - 6 : n.x + n.w + 6}
                y={n.y + n.h / 2}
                textAnchor={n.column === 'right' ? 'end' : 'start'}
                dominantBaseline="middle"
                className="fill-ink-200 text-[11px] tabular-nums"
              >
                <tspan>{n.label}</tspan>
                <tspan>{' · '}{formatAmount(n.amount, model.currency)}</tspan>
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
