import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAmountCompact, formatDateShort } from '../../../lib/format';
import { computeActiveWindow, buildAxisTicks } from '../../../components/BalanceChart/lib';
import {
  useBalanceChartInteractions,
  type ZoomState,
} from '../../../components/BalanceChart/useBalanceChartInteractions';
import { buildGainAreas, buildStepPath, buildValueSegments, computePlacementRange } from './geometry';
import { PlacementsTooltip } from './PlacementsTooltip';
import type { PlacementPoint } from './series';

interface Props {
  points: PlacementPoint[];
  currency: string;
  granularity: 'day' | 'month';
  height?: number;
}

const W = 1000;
const PAD = { top: 24, right: 24, bottom: 32, left: 64 };
// Dots would crowd a dense daily series; they only help on sparse ones.
const MAX_DOTS = 60;

export function PlacementsChart({ points, currency, granularity, height = 240 }: Props): JSX.Element {
  const { t } = useTranslation('dashboard');
  const [zoom, setZoom] = useState<ZoomState | null>(null);
  const innerW = W - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;

  // PlacementPoint.value is Valeur, so the points double as the hook's
  // {date, value} samples.
  const { minY, range } = useMemo(() => computePlacementRange(points), [points]);
  const { activeFirstMs, activeLastMs, xSpan } =
    points.length > 0 ? computeActiveWindow(points, zoom) : { activeFirstMs: 0, activeLastMs: 1, xSpan: 1 };
  const xScale = (date: string) => PAD.left + ((Date.parse(date) - activeFirstMs) / xSpan) * innerW;
  const xScaleAt = (i: number) => xScale(points[i]!.date);
  const yScale = (v: number) => PAD.top + innerH - ((v - minY) / range) * innerH;
  const vbToMs = (vb: number) => activeFirstMs + ((vb - PAD.left) / innerW) * (activeLastMs - activeFirstMs);

  const { containerRef, svgRef, hover, drag, dragRect, onMove, onPointerDown, onPointerUp, onPointerLeave } =
    useBalanceChartInteractions({ data: points, xScaleAt, yScale, vbToMs, w: W, h: height, pad: PAD, setZoom });

  if (points.length < 2) {
    return <div className="text-sm text-ink-500 py-12 text-center font-display italic">{t('placements.empty')}</div>;
  }

  const stepPath = buildStepPath(points, xScaleAt, yScale);
  const segments = buildValueSegments(points, xScaleAt, yScale);
  const areas = buildGainAreas(points, xScaleAt, yScale);
  const { tickValues, xTicks } = buildAxisTicks({ minY, range, activeFirstMs, xSpan, dataLength: points.length });
  const last = points[points.length - 1]!;
  const hovered = hover !== null ? points[hover.idx] : null;

  return (
    <div ref={containerRef} className="w-full relative">
      <svg
        ref={svgRef}
        role="img"
        aria-label={t('placements.chartAria', {
          count: points.length,
          from: formatDateShort(points[0]!.date),
          to: formatDateShort(last.date),
          value: formatAmountCompact(last.value, currency),
          contributed: formatAmountCompact(last.contributed, currency),
        })}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        style={{ height, cursor: drag !== null ? 'ew-resize' : zoom ? 'zoom-out' : 'crosshair' }}
        onMouseMove={onMove}
        onMouseLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerMove={onMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onDoubleClick={() => setZoom(null)}
      >
        <defs>
          <clipPath id="placements-clip">
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {tickValues.map((tv, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yScale(tv)} x2={W - PAD.right} y2={yScale(tv)} stroke="#1d2230" strokeDasharray="2 6" />
            <text x={PAD.left - 10} y={yScale(tv) + 4} fill="#5b6478" fontSize="11" textAnchor="end" fontFamily="JetBrains Mono Variable, monospace" className="private">
              {formatAmountCompact(tv, currency)}
            </text>
          </g>
        ))}
        {xTicks.map((date, i) => (
          <text key={i} x={xScale(date)} y={height - 10} fill="#5b6478" fontSize="10" textAnchor="middle" fontFamily="JetBrains Mono Variable, monospace">
            {formatDateShort(date)}
          </text>
        ))}

        <g clipPath="url(#placements-clip)">
          {areas.positive && <path data-testid="gain-area-positive" d={areas.positive} fill="#7dd3c0" fillOpacity="0.22" />}
          {areas.negative && <path data-testid="gain-area-negative" d={areas.negative} fill="#dc7861" fillOpacity="0.25" />}
          <path d={stepPath} fill="none" stroke="#9aa3b5" strokeWidth="1.5" />
          {segments.map((s, i) => (
            <path key={i} d={s.d} fill="none" stroke="#7dd3c0" strokeWidth="1.75" strokeDasharray={s.dashed ? '4 5' : undefined} strokeLinecap={s.dashed ? 'round' : undefined} />
          ))}
          {points.length <= MAX_DOTS &&
            points.map((p, i) =>
              p.estimated ? null : <circle key={i} data-testid="valuation-dot" cx={xScaleAt(i)} cy={yScale(p.value)} r="3" fill="#7dd3c0" />,
            )}

          {hover !== null && drag === null && (
            <g pointerEvents="none">
              <line x1={xScaleAt(hover.idx)} y1={PAD.top} x2={xScaleAt(hover.idx)} y2={PAD.top + innerH} stroke="#5b6478" strokeDasharray="3 4" strokeWidth="1" />
              <circle cx={xScaleAt(hover.idx)} cy={yScale(points[hover.idx]!.value)} r="5" fill="#0b0d11" stroke="#7dd3c0" strokeWidth="2" />
            </g>
          )}
          {dragRect && <rect x={dragRect.x} y={PAD.top} width={dragRect.width} height={innerH} fill="#7dd3c0" opacity="0.14" pointerEvents="none" />}
        </g>
      </svg>

      {zoom !== null && (
        <button type="button" onClick={() => setZoom(null)} className="absolute top-2 right-2 text-[11px] text-ink-300 hover:text-ink-50 bg-ink-900/85 border border-ink-800 hover:border-ink-700 rounded-md px-2 py-1 transition">
          {t('placements.zoomReset')}
        </button>
      )}

      {hover !== null && drag === null && hovered && (
        <PlacementsTooltip point={hovered} currency={currency} x={hover.x} y={hover.y} containerWidth={containerRef.current?.clientWidth ?? 1000} granularity={granularity} />
      )}
    </div>
  );
}
