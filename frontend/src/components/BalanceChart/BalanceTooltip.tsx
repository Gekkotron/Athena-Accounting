import { formatAmount, formatDate } from '../../lib/format';
import type { SeriesPoint } from './series';
import type { CheckpointMark } from './checkpoints';

interface Props {
  hovered: SeriesPoint;
  hoveredCheckpoint: CheckpointMark | null;
  currency: string;
  x: number;
  y: number;
  containerWidth: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// HTML tooltip — position absolute relative to the container, snapped to
// the data point. -translate-x-1/2 + -translate-y-full + -mt-3 puts it just
// above the dot, centered horizontally. The container also clamps the X so
// the tooltip never overflows on the sides.
export function BalanceTooltip({ hovered, hoveredCheckpoint, currency, x, y, containerWidth }: Props): JSX.Element {
  return (
    <div
      className="absolute pointer-events-none surface px-3 py-2 shadow-card min-w-[140px]"
      style={{
        left: clamp(x, 80, containerWidth - 80),
        top: y,
        transform: 'translate(-50%, calc(-100% - 14px))',
      }}
    >
      <div className="font-mono text-[10px] text-ink-500 mb-0.5">
        {formatDate(hovered.date)}
      </div>
      <div className={`font-mono text-sm tabular-nums ${hovered.value < 0 ? 'text-clay-300' : hovered.value > 0 ? 'text-sage-300' : 'text-ink-300'}`}>
        {formatAmount(hovered.value, currency)}
      </div>
      {hoveredCheckpoint && (
        <div className="mt-1 pt-1 border-t border-ink-800/60 font-mono text-[10px] text-ink-500">
          {/* Explicit checkpoint date so the écart is unambiguously tied
              to the checkpoint you set, not to the hovered bucket. */}
          <div className="text-ink-400 mb-0.5">
            point de contrôle · <span className="text-ink-200">{formatDate(hoveredCheckpoint.date)}</span>
          </div>
          {hoveredCheckpoint.drift ? (
            <>
              <div>attendu · <span className="text-ink-300">{formatAmount(hoveredCheckpoint.expectedAmount, currency)}</span></div>
              <div>réel · <span className="text-ink-300">{formatAmount(hoveredCheckpoint.actual, currency)}</span></div>
              <div className="text-amber-300">écart · {formatAmount(hoveredCheckpoint.delta, currency)}</div>
            </>
          ) : (
            <div className="text-sage-300">attendu ✓ {formatAmount(hoveredCheckpoint.expectedAmount, currency)}</div>
          )}
        </div>
      )}
    </div>
  );
}
