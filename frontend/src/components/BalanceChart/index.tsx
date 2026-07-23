import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BalancePoint } from '../../api/types';
import { formatAmountCompact, formatDateShort } from '../../lib/format';
import { buildAggregatedSeries } from './series';
import { buildCheckpointMarks, type Checkpoint } from './checkpoints';
import { BalanceTooltip } from './BalanceTooltip';
import {
  mergeHistoricalAndProjection,
  computeYRange,
  computeActiveWindow,
  buildSegments,
  buildAreaPath,
  buildAxisTicks,
} from './lib';
import {
  useBalanceChartInteractions,
  type ZoomState,
} from './useBalanceChartInteractions';

interface Props {
  points: BalancePoint[];
  currency: string;
  height?: number;
  checkpoints?: Checkpoint[];
  // Gaps greater than this many days between consecutive buckets are drawn
  // dotted, signalling missing data. Default 6 keeps weekends + short quiet
  // stretches solid.
  gapThresholdDays?: number;
  // Optional forward projection appended to the historical line. Each
  // entry is a { date, value } sample; the projection extends the X-axis
  // and renders every projection-side segment in a dashed variant so the
  // uncertainty is visually distinct from the historical solid line.
  projection?: Array<{ date: string; value: number }>;
  // Optional authoritative "as of today" balance. When set, the historical
  // curve is shifted so its endpoint lands exactly on this value — which
  // matters when the timeseries endpoint under-counts accounts that had no
  // activity in the visible window (their opening balance never gets
  // carried into the sum). The projection is anchored to the same value,
  // so with this set the historical/projection join is always continuous.
  alignEndTo?: number;
}

export function BalanceChart({ points, currency, height = 240, checkpoints, gapThresholdDays = 6, projection, alignEndTo }: Props): JSX.Element {
  const { t } = useTranslation('charts');
  const [zoom, setZoom] = useState<ZoomState | null>(null);

  const { data, projectionStartIdx } = useMemo(
    () =>
      mergeHistoricalAndProjection({
        raw: buildAggregatedSeries(points, currency),
        alignEndTo,
        projection,
      }),
    [points, currency, projection, alignEndTo],
  );

  const w = 1000;
  const h = height;
  const pad = { top: 24, right: 24, bottom: 32, left: 64 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const { minY, maxY, range } = computeYRange(data);

  // Time-based X scale — maps a calendar date to a viewBox X. Under an
  // active zoom, the scale narrows to just the zoom window so that window
  // spans the full plot width; out-of-window buckets fall outside
  // [pad.left, w - pad.right] and get clipped by <clipPath id="chart-clip">.
  // Guarded on data.length so the empty-state branch below still gets
  // consistent hook ordering (useBalanceChartInteractions runs on every path).
  const { activeFirstMs, activeLastMs, xSpan } =
    data.length > 0 ? computeActiveWindow(data, zoom) : { activeFirstMs: 0, activeLastMs: 1, xSpan: 1 };
  const xScale = (date: string) => pad.left + ((Date.parse(date) - activeFirstMs) / xSpan) * innerW;
  const xScaleAt = (i: number) => xScale(data[i]!.date);
  const yScale = (v: number) => pad.top + innerH - ((v - minY) / range) * innerH;
  // Inverse of xScale: viewBox X → ms. Used to convert a drag range back to
  // a calendar zoom window.
  const vbToMs = (vb: number) => activeFirstMs + ((vb - pad.left) / innerW) * (activeLastMs - activeFirstMs);

  const {
    containerRef,
    svgRef,
    hover,
    drag,
    dragRect,
    onMove,
    onPointerDown,
    onPointerUp,
    onPointerLeave,
  } = useBalanceChartInteractions({ data, xScaleAt, yScale, vbToMs, w, h, pad, setZoom });

  if (data.length < 2) {
    return (
      <div className="text-sm text-ink-500 py-12 text-center font-display italic">
        {t('balanceChart.notEnoughData')}
      </div>
    );
  }

  const marks = buildCheckpointMarks(data, checkpoints, xScale);
  const { areaPath } = buildAreaPath({ data, projectionStartIdx, xScaleAt, yScale, pad, innerH });
  const segments = buildSegments({ data, projectionStartIdx, gapThresholdDays, xScaleAt, yScale });
  const { tickValues, xTicks } = buildAxisTicks({
    minY,
    range,
    activeFirstMs,
    xSpan,
    dataLength: data.length,
  });
  const zeroY = yScale(0);

  const hovered = hover !== null ? data[hover.idx] : null;

  // Show the checkpoint's expected/actual/delta line in the tooltip when the
  // MOUSE (not the snapped bucket) is within ~10 viewBox units of a
  // checkpoint's X. Uses mouseViewBoxX rather than the snapped bucket X: on
  // a time-based axis a bucket close in date to the checkpoint can still be
  // far in pixels if surrounding data is sparse, so the old "hovered bucket
  // ≈ checkpoint" heuristic would miss real matches. 10 (was 6) also gives
  // a slightly more forgiving landing zone on the diamond itself.
  const HOVER_PROXIMITY_VB = 10;
  const hoveredCheckpoint = (() => {
    if (hover === null) return null;
    let closest: (typeof marks)[number] | null = null;
    let closestDist = Infinity;
    for (const m of marks) {
      const d = Math.abs(m.cx - hover.mouseViewBoxX);
      if (d < closestDist && d <= HOVER_PROXIMITY_VB) {
        closest = m;
        closestDist = d;
      }
    }
    return closest;
  })();

  return (
    <div ref={containerRef} className="w-full relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        style={{ height, cursor: drag !== null ? 'ew-resize' : (zoom ? 'zoom-out' : 'crosshair') }}
        onMouseMove={onMove}
        onMouseLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerMove={onMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={() => setZoom(null)}
      >
        <defs>
          <linearGradient id="g-balance" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7dd3c0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#7dd3c0" stopOpacity="0" />
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="chart-clip">
            <rect x={pad.left} y={pad.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {/* horizontal grid */}
        {tickValues.map((t, i) => (
          <g key={i}>
            <line x1={pad.left} y1={yScale(t)} x2={w - pad.right} y2={yScale(t)} stroke={t === 0 ? '#3a4252' : '#1d2230'} strokeDasharray={t === 0 ? undefined : '2 6'} />
            <text x={pad.left - 10} y={yScale(t) + 4} fill="#5b6478" fontSize="11" textAnchor="end" fontFamily="JetBrains Mono Variable, monospace" className="private">
              {formatAmountCompact(t, currency)}
            </text>
          </g>
        ))}

        {/* x-axis labels — evenly spaced by calendar time on the active window. */}
        {xTicks.map((date, i) => (
          <text key={i} x={xScale(date)} y={h - 10} fill="#5b6478" fontSize="10" textAnchor="middle" fontFamily="JetBrains Mono Variable, monospace">
            {formatDateShort(date)}
          </text>
        ))}

        {/* All chart content is clipped to the plot rect so zoomed-out data
            doesn't spill into the axis padding. */}
        <g clipPath="url(#chart-clip)">
          <path d={areaPath} fill="url(#g-balance)" />
          {segments.map((s, i) => (
            <path key={i} d={s.d} fill="none" stroke="#7dd3c0" strokeWidth="1.75" strokeDasharray={s.dashed ? '4 5' : undefined} strokeLinecap={s.dashed ? 'round' : undefined} filter={s.dashed ? undefined : 'url(#glow)'} />
          ))}

          {/* Balance checkpoints — diamond markers + optional drift guide */}
          {marks.map((m) => {
            const cyExpected = yScale(m.expectedAmount);
            const cyActual = yScale(m.actual);
            const color = m.drift ? '#f6c177' : '#7dd3c0'; // amber vs. sage
            const fill = m.drift ? color : 'none';
            return (
              <g key={`cp-${m.date}`} pointerEvents="none">
                {m.drift && (
                  <line x1={m.cx} y1={cyExpected} x2={m.cx} y2={cyActual} stroke={color} strokeDasharray="3 3" strokeWidth="1" opacity="0.8" />
                )}
                {/* Diamond = rotated 4-sided path centered on (m.cx, cyExpected) */}
                <path d={`M ${m.cx} ${cyExpected - 5} L ${m.cx + 5} ${cyExpected} L ${m.cx} ${cyExpected + 5} L ${m.cx - 5} ${cyExpected} Z`} fill={fill} stroke={color} strokeWidth="2" />
                {m.drift && <circle cx={m.cx} cy={cyActual} r="2" fill={color} />}
              </g>
            );
          })}

          {/* end marker — anchored at the last HISTORICAL point when a
              projection is present, so the dot always marks "here's the
              measured now" rather than the tip of the uncertain extension. */}
          {(() => {
            const endIdx = Math.max(0, projectionStartIdx - 1);
            const endPoint = data[endIdx]!;
            return (
              <>
                <circle cx={xScaleAt(endIdx)} cy={yScale(endPoint.value)} r="3.5" fill="#7dd3c0" />
                <circle cx={xScaleAt(endIdx)} cy={yScale(endPoint.value)} r="7" fill="#7dd3c0" opacity="0.18" />
              </>
            );
          })()}

          {/* hover guide + highlighted dot */}
          {hover !== null && drag === null && (
            <g pointerEvents="none">
              <line x1={xScaleAt(hover.idx)} y1={pad.top} x2={xScaleAt(hover.idx)} y2={pad.top + innerH} stroke="#5b6478" strokeDasharray="3 4" strokeWidth="1" />
              <circle cx={xScaleAt(hover.idx)} cy={yScale(data[hover.idx]!.value)} r="5" fill="#0b0d11" stroke="#7dd3c0" strokeWidth="2" />
            </g>
          )}

          {/* Live brush selection */}
          {dragRect && (
            <rect x={dragRect.x} y={pad.top} width={dragRect.width} height={innerH} fill="#7dd3c0" opacity="0.14" pointerEvents="none" />
          )}
        </g>

        {minY < 0 && maxY > 0 && (
          <text x={w - pad.right + 4} y={zeroY + 4} fill="#3a4252" fontSize="10" fontFamily="Fraunces Variable, serif" fontStyle="italic">
            0
          </text>
        )}
      </svg>

      {zoom !== null && (
        <button type="button" onClick={() => setZoom(null)} className="absolute top-2 right-2 text-[11px] text-ink-300 hover:text-ink-50 bg-ink-900/85 border border-ink-800 hover:border-ink-700 rounded-md px-2 py-1 transition" title={t('balanceChart.zoomReset.title')}>
          {t('balanceChart.zoomReset.button')}
        </button>
      )}

      {hover !== null && drag === null && hovered && (
        <BalanceTooltip hovered={hovered} hoveredCheckpoint={hoveredCheckpoint} currency={currency} x={hover.x} y={hover.y} containerWidth={containerRef.current?.clientWidth ?? 1000} previousValue={hover.idx > 0 ? data[hover.idx - 1]!.value : null} />
      )}
    </div>
  );
}
