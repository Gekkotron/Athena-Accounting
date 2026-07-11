import { useMemo, useState } from 'react';
import { layoutSankey, type SankeyModel, type LaidOutNode } from '../pages/Dashboard/sankey';
import { formatAmount } from '../lib/format';

const VIEW_W = 720;
const VIEW_H = 360;

// Special-tone accents (see tailwind.config.js): sage-300 for positive
// (Épargne), clay-400 for negative (Épargne puisée). Uncoloured category
// nodes fall through to the shared categorical palette below.
const SAGE = '#7dd3c0';
const CLAY = '#dc7861';
const INK_NEUTRAL = '#5b6478';

// Same categorical palette CategoryDonut uses — reused so that a category
// keeps the same hue across donut and Sankey views on the same page.
const FALLBACK_PALETTE = [
  '#7dd3c0', '#dc7861', '#d4a05a', '#7aa8d4', '#b08fd4',
  '#97b87f', '#d48ba8', '#6cc1bb', '#caa97a', '#9cb6d4',
];

function resolveColor(
  n: { tone: LaidOutNode['tone']; color: string | null },
  fallbackIndex: number,
): string {
  if (n.tone === 'sage') return SAGE;
  if (n.tone === 'clay') return CLAY;
  if (n.color) return n.color;
  if (n.tone === 'neutral') return INK_NEUTRAL;
  return FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length]!;
}

export function Sankey({ model }: { model: SankeyModel }): JSX.Element {
  const layout = useMemo(
    () => layoutSankey(model, { width: VIEW_W, height: VIEW_H }),
    [model],
  );

  // Pre-resolve each node's colour so palette-fallback indices stay stable
  // across hover state changes (a colour that shifts on hover is a bug).
  const colorByKey = useMemo(() => {
    const map = new Map<string, string>();
    let li = 0;
    let ri = 0;
    for (const n of layout.nodes) {
      if (n.key === 'pool') {
        map.set(n.key, INK_NEUTRAL);
      } else if (n.column === 'left') {
        map.set(n.key, resolveColor(n, li++));
      } else {
        map.set(n.key, resolveColor(n, ri++));
      }
    }
    return map;
  }, [layout.nodes]);

  // The pool's visible y-range on screen is the union of the left and right
  // ribbon stacks. Sizes can differ when min-floor bumps hit one side more
  // than the other — the spine must cover the union so ribbons never render
  // past its ends.
  const flowSpan = useMemo(() => {
    const rightHeight = layout.links
      .filter((l) => l.sourceKey === 'pool')
      .reduce((s, l) => s + l.width, 0);
    const leftHeight = layout.links
      .filter((l) => l.targetKey === 'pool')
      .reduce((s, l) => s + l.width, 0);
    const rightTop = (layout.height - rightHeight) / 2;
    const leftTop = (layout.height - leftHeight) / 2;
    const yTop = Math.min(rightTop, leftTop);
    const yBot = Math.max(rightTop + rightHeight, leftTop + leftHeight);
    return { yTop, height: yBot - yTop };
  }, [layout.links, layout.height]);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const hoveredNode = hoveredKey ? layout.nodes.find((n) => n.key === hoveredKey) : null;

  const ariaLabel =
    `Flux : ${formatAmount(model.totalIncome, model.currency)} de revenus, ` +
    `${formatAmount(model.totalExpense, model.currency)} de dépenses`;

  const pool = layout.nodes.find((n) => n.key === 'pool');

  // Header: caption row above the SVG. The centre cell doubles as a
  // tooltip surface — on hover it swaps in the hovered node's details.
  const hoverPct = hoveredNode
    ? Math.round((hoveredNode.amount / (model.totalIncome || 1)) * 100)
    : 0;
  const centerCaption = hoveredNode ? hoveredNode.label : 'Revenus';
  const centerAmount = hoveredNode ? hoveredNode.amount : model.totalIncome;
  const centerColor = hoveredNode ? (colorByKey.get(hoveredNode.key) ?? '#e6e8ed') : '#e6e8ed';

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-3 items-end gap-2 mb-4 px-1">
        <div className="label">Sources</div>
        <div className="text-center min-h-[44px]">
          <div className="label mb-0.5" style={{ transition: 'color 180ms' }}>
            {centerCaption}
          </div>
          <div
            className="display-italic text-lg tabular-nums leading-tight"
            style={{ color: centerColor, transition: 'color 180ms' }}
          >
            {formatAmount(centerAmount, model.currency)}
            {hoveredNode && (
              <span className="ml-2 font-sans not-italic text-xs text-ink-500">
                · {hoverPct}%
              </span>
            )}
          </div>
        </div>
        <div className="label text-right">Postes</div>
      </div>

      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${VIEW_W} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full min-w-[520px]"
      >
        {/* Central spine — thin ink bar spanning only the flow's y-range, so
            it reads as a junction rather than a full-height wall. */}
        {pool && flowSpan.height > 0 && (
          <rect
            x={pool.x}
            y={flowSpan.yTop}
            width={pool.w}
            height={flowSpan.height}
            rx={4}
            fill="#272d3b"
          />
        )}

        {/* Ribbons — filled areas, coloured by whichever end is the
            non-pool node. Two-tier opacity: everything dims while a node
            is hovered, the ribbons touching that node stay bright. */}
        <g>
          {layout.links.map((l) => {
            const accentKey = l.sourceKey === 'pool' ? l.targetKey : l.sourceKey;
            const color = colorByKey.get(accentKey) ?? INK_NEUTRAL;
            const isHi = hoveredKey === accentKey;
            const isDim = hoveredKey !== null && !isHi;
            const opacity = isHi ? 0.72 : isDim ? 0.08 : 0.32;
            return (
              <path
                key={l.key}
                d={l.path}
                fill={color}
                opacity={opacity}
                style={{ transition: 'opacity 180ms ease-out' }}
              />
            );
          })}
        </g>

        {/* Nodes — small rounded bars with a two-line label beside them.
            The pool node itself is drawn as the spine above; skip it here. */}
        <g>
          {layout.nodes.map((n) => {
            if (n.key === 'pool') return null;
            const color = colorByKey.get(n.key) ?? INK_NEUTRAL;
            const isHi = hoveredKey === n.key;
            const isDim = hoveredKey !== null && !isHi;
            const isRight = n.column === 'right';
            const labelX = isRight ? n.x - 8 : n.x + n.w + 8;
            const anchor: 'start' | 'end' = isRight ? 'end' : 'start';
            return (
              <g
                key={n.key}
                onMouseEnter={() => setHoveredKey(n.key)}
                onMouseLeave={() => setHoveredKey(null)}
                style={{ transition: 'opacity 180ms ease-out', cursor: 'default' }}
                opacity={isDim ? 0.45 : 1}
              >
                {/* Expanded hit target so hover isn't finicky on tiny nodes. */}
                <rect
                  x={n.x - 4}
                  y={n.y - 3}
                  width={n.w + 8}
                  height={n.h + 6}
                  fill="transparent"
                />
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx={3}
                  fill={color}
                  style={{
                    transition: 'filter 180ms',
                    filter: isHi ? 'brightness(1.15)' : undefined,
                  }}
                />
                <text
                  x={labelX}
                  y={n.y + n.h / 2 - 2}
                  textAnchor={anchor}
                  dominantBaseline="text-after-edge"
                  className="fill-ink-100 text-[11px]"
                >
                  {n.label}
                </text>
                <text
                  x={labelX}
                  y={n.y + n.h / 2 + 2}
                  textAnchor={anchor}
                  dominantBaseline="text-before-edge"
                  className={`text-[11px] tabular-nums ${
                    isHi ? 'fill-ink-50' : 'fill-ink-300'
                  }`}
                >
                  {formatAmount(n.amount, model.currency)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
