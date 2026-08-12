import { useTranslation } from 'react-i18next';
import type { LaidOutNode } from '../pages/Dashboard/sankey';
import { formatAmount } from '../lib/format';

interface Props {
  node: LaidOutNode;
  pointer: { x: number; y: number };
  wrapperWidth: number;
  wrapperHeight: number;
  currency: string;
}

export function SankeyBreakdownTooltip({
  node, pointer, wrapperWidth, wrapperHeight, currency,
}: Props): JSX.Element {
  const { t } = useTranslation('charts');
  const items = node.breakdown ?? [];
  // Flip to the left of the cursor when close to the right edge so the
  // panel never overflows the wrapper. 220 px is the tooltip's target width.
  const flipLeft = pointer.x + 220 + 16 > wrapperWidth;
  // Flip above the cursor when the tooltip would overflow the wrapper's
  // bottom. The wrapper has `overflow-x-auto` for the min-width SVG, which
  // per spec promotes overflow-y to auto too — so a tooltip drawn past the
  // bottom edge gets clipped rather than spilling over. Height is estimated
  // from item count (40 px chrome + header, ~20 px per row) with a small
  // safety margin so the flip triggers before the clip does.
  const estHeight = 40 + items.length * 20;
  const flipUp = pointer.y + estHeight + 12 > wrapperHeight;
  const style: React.CSSProperties = {
    position: 'absolute',
    ...(flipUp
      ? { bottom: Math.max(0, wrapperHeight - pointer.y + 12) }
      : { top: pointer.y + 12 }),
    ...(flipLeft ? { right: Math.max(0, wrapperWidth - pointer.x + 12) } : { left: pointer.x + 12 }),
    pointerEvents: 'none',
    width: 220,
  };
  return (
    <div
      role="tooltip"
      style={style}
      className="z-10 rounded-md border border-ink-700 bg-ink-900/95 px-3 py-2 shadow-lg backdrop-blur-sm"
    >
      <div className="label mb-1.5 flex items-baseline justify-between gap-2">
        <span>{node.label}</span>
        <span className="text-[10px] text-ink-400">{t('sankey.breakdownCount', { count: items.length })}</span>
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="flex items-center gap-2 text-[11px]">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-sm"
              style={{ background: it.color }}
            />
            <span className="flex-1 truncate text-ink-200">{it.label}</span>
            <span className="tabular-nums text-ink-100">{formatAmount(it.amount, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
