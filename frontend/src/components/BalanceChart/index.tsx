import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BalancePoint } from '../../api/types';
import { formatAmountCompact, formatDateShort } from '../../lib/format';
import { buildAggregatedSeries } from './series';
import { buildCheckpointMarks, type Checkpoint } from './checkpoints';
import { BalanceTooltip } from './BalanceTooltip';

interface Props {
  points: BalancePoint[];
  currency: string;
  height?: number;
  checkpoints?: Checkpoint[];
  // Gaps greater than this many days between consecutive buckets are drawn
  // dotted, signalling missing data. Default 6 keeps weekends + short quiet
  // stretches solid.
  gapThresholdDays?: number;
}

interface HoverState {
  idx: number;
  // viewBox X of the mouse itself (not the snapped bucket). Used to decide
  // whether the mouse is close enough to a checkpoint to show its drift in
  // the tooltip — under a time-based X, buckets near a checkpoint can still
  // be far in pixels if the surrounding data is sparse.
  mouseViewBoxX: number;
  // Container-relative coordinates of the snapped data point, used to
  // absolutely position the HTML tooltip so it tracks the point even when
  // the SVG is scaled to fit different container widths.
  x: number;
  y: number;
}

// Active brush drag in viewBox coordinates. The rectangle is drawn between
// `startVb` and `endVb`; on release, the range is committed as a zoom
// window (or discarded if too narrow to be intentional).
interface DragState {
  startVb: number;
  endVb: number;
}

interface ZoomState {
  startMs: number;
  endMs: number;
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// A drag narrower than this (in viewBox units, out of 1000) is treated as
// a stray click, not a zoom request.
const MIN_ZOOM_WIDTH_VB = 10;

export function BalanceChart({ points, currency, height = 240, checkpoints, gapThresholdDays = 6 }: Props): JSX.Element {
  const { t } = useTranslation('charts');
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [zoom, setZoom] = useState<ZoomState | null>(null);

  const data = useMemo(() => buildAggregatedSeries(points, currency), [points, currency]);

  if (data.length < 2) {
    return (
      <div className="text-sm text-ink-500 py-12 text-center font-display italic">
        {t('balanceChart.notEnoughData')}
      </div>
    );
  }

  const w = 1000;
  const h = height;
  const pad = { top: 24, right: 24, bottom: 32, left: 64 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const ys = data.map((d) => d.value);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 0);
  const range = maxY - minY || 1;

  // Time-based X scale — maps a calendar date to a viewBox X. Under an
  // active zoom, the scale narrows to just the zoom window so that window
  // spans the full plot width; out-of-window buckets fall outside
  // [pad.left, w - pad.right] and get clipped by <clipPath id="chart-clip">.
  const dataFirstMs = Date.parse(data[0]!.date);
  const dataLastMs = Date.parse(data[data.length - 1]!.date);
  const activeFirstMs = zoom?.startMs ?? dataFirstMs;
  const activeLastMs = zoom?.endMs ?? dataLastMs;
  const xSpan = Math.max(1, activeLastMs - activeFirstMs);
  const xScale = (date: string) => pad.left + ((Date.parse(date) - activeFirstMs) / xSpan) * innerW;
  const xScaleAt = (i: number) => xScale(data[i]!.date);
  const yScale = (v: number) => pad.top + innerH - ((v - minY) / range) * innerH;
  // Inverse of xScale: viewBox X → ms. Used to convert a drag range back to
  // a calendar zoom window.
  const vbToMs = (vb: number) => activeFirstMs + ((vb - pad.left) / innerW) * (activeLastMs - activeFirstMs);

  const marks = buildCheckpointMarks(data, checkpoints, xScale);

  const path = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScaleAt(i).toFixed(1)} ${yScale(d.value).toFixed(1)}`)
    .join(' ');

  const areaPath = `${path} L ${xScaleAt(data.length - 1).toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${xScaleAt(0).toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;

  // Split the stroked line into runs of consecutive segments sharing the same
  // "dashed" verdict. A segment is dashed when the two data points bracket a
  // gap of more than `gapThresholdDays` — telling the user that we have no
  // data for that stretch (missed import, ingestion gap, …). The area path
  // stays continuous — the dotted stroke alone communicates the uncertainty.
  const segments: { d: string; dashed: boolean }[] = [];
  {
    let runStart = 0;
    let runDashed: boolean | null = null;
    for (let i = 1; i < data.length; i++) {
      const gap = Math.round(
        (Date.parse(data[i]!.date) - Date.parse(data[i - 1]!.date)) / 86_400_000,
      );
      const dashed = gap > gapThresholdDays;
      if (runDashed === null) {
        runDashed = dashed;
        continue;
      }
      if (dashed !== runDashed) {
        segments.push({
          d: data
            .slice(runStart, i)
            .map((p, k) => `${k === 0 ? 'M' : 'L'} ${xScaleAt(runStart + k).toFixed(1)} ${yScale(p.value).toFixed(1)}`)
            .join(' '),
          dashed: runDashed,
        });
        runStart = i - 1;
        runDashed = dashed;
      }
    }
    segments.push({
      d: data
        .slice(runStart)
        .map((p, k) => `${k === 0 ? 'M' : 'L'} ${xScaleAt(runStart + k).toFixed(1)} ${yScale(p.value).toFixed(1)}`)
        .join(' '),
      dashed: runDashed ?? false,
    });
  }

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => minY + (range * i) / ticks);
  // Evenly-spaced calendar ticks — computed by time on the ACTIVE window,
  // so a zoomed-in view relabels the axis for that window.
  const xTickCount = Math.min(6, Math.max(2, data.length));
  const xTicks: string[] = Array.from({ length: xTickCount }, (_, i) =>
    isoDate(activeFirstMs + (i * xSpan) / (xTickCount - 1)),
  );

  const zeroY = yScale(0);
  const last = data[data.length - 1]!;

  const getViewBoxX = (clientX: number): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * w;
  };

  const inPlotArea = (vbX: number): boolean => vbX >= pad.left && vbX <= w - pad.right;

  // Pointer down starts a brush drag when inside the plot area. Skipped on
  // touch so the OS scroll gesture wins on mobile.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'touch') return;
    const vbX = getViewBoxX(e.clientX);
    if (!inPlotArea(vbX)) return;
    setDrag({ startVb: vbX, endVb: vbX });
    (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
  };

  // Pointer move handler — updates the drag rect if a brush is active, and
  // always keeps the hover tooltip anchored to the nearest data point.
  const onMove = (e: React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;
    const svgRect = svg.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const xInViewBox = ((e.clientX - svgRect.left) / svgRect.width) * w;

    if (drag !== null) {
      // Clamp the drag endpoint to the plot area so a fling into the
      // padding doesn't produce a useless zoom window.
      const clamped = Math.max(pad.left, Math.min(w - pad.right, xInViewBox));
      setDrag({ startVb: drag.startVb, endVb: clamped });
      return; // suppress hover updates while dragging — tooltip would flicker
    }

    // Snap only to buckets currently in the active window (their X sits in
    // the plot area). Under zoom, out-of-window buckets have X far outside
    // and are visually clipped — tooltiping them would be surprising.
    // Seed `closest` with the first in-plot bucket so a degenerate mouse
    // coord (e.g. NaN from jsdom's zero-size layout in tests) still lands
    // on something visible instead of dropping the tooltip.
    let closest = -1;
    for (let i = 0; i < data.length; i++) {
      const cx = xScaleAt(i);
      if (cx >= pad.left - 1 && cx <= w - pad.right + 1) { closest = i; break; }
    }
    if (closest < 0) {
      setHover(null);
      return;
    }
    let minDist = Math.abs(xScaleAt(closest) - xInViewBox);
    for (let i = closest + 1; i < data.length; i++) {
      const cx = xScaleAt(i);
      if (cx < pad.left - 1 || cx > w - pad.right + 1) continue;
      const dist = Math.abs(cx - xInViewBox);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }

    const px = (xScaleAt(closest) / w) * svgRect.width;
    const py = (yScale(data[closest]!.value) / h) * svgRect.height;

    setHover({
      idx: closest,
      mouseViewBoxX: xInViewBox,
      x: svgRect.left - containerRect.left + px,
      y: svgRect.top - containerRect.top + py,
    });
  };

  const commitZoomFromDrag = (d: DragState) => {
    const width = Math.abs(d.endVb - d.startVb);
    if (width < MIN_ZOOM_WIDTH_VB) return; // stray click — ignore
    const a = vbToMs(d.startVb);
    const b = vbToMs(d.endVb);
    setZoom({ startMs: Math.min(a, b), endMs: Math.max(a, b) });
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag !== null) {
      commitZoomFromDrag(drag);
      setDrag(null);
    }
    (e.currentTarget as SVGSVGElement).releasePointerCapture?.(e.pointerId);
  };

  const onPointerLeave = () => {
    setHover(null);
    // Keep `drag` active if the pointer is captured — the user can drag out
    // and back in. Pointer capture ensures we still receive the eventual
    // pointerup even when the pointer leaves the SVG bounds.
  };

  const onDoubleClick = () => setZoom(null);

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

  const dragRect = drag !== null && Math.abs(drag.endVb - drag.startVb) >= MIN_ZOOM_WIDTH_VB
    ? { x: Math.min(drag.startVb, drag.endVb), width: Math.abs(drag.endVb - drag.startVb) }
    : null;

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
        onDoubleClick={onDoubleClick}
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
            <line
              x1={pad.left}
              y1={yScale(t)}
              x2={w - pad.right}
              y2={yScale(t)}
              stroke={t === 0 ? '#3a4252' : '#1d2230'}
              strokeDasharray={t === 0 ? undefined : '2 6'}
            />
            <text
              x={pad.left - 10}
              y={yScale(t) + 4}
              fill="#5b6478"
              fontSize="11"
              textAnchor="end"
              fontFamily="JetBrains Mono Variable, monospace"
              className="private"
            >
              {formatAmountCompact(t, currency)}
            </text>
          </g>
        ))}

        {/* x-axis labels — evenly spaced by calendar time on the active window. */}
        {xTicks.map((date, i) => (
          <text
            key={i}
            x={xScale(date)}
            y={h - 10}
            fill="#5b6478"
            fontSize="10"
            textAnchor="middle"
            fontFamily="JetBrains Mono Variable, monospace"
          >
            {formatDateShort(date)}
          </text>
        ))}

        {/* All chart content is clipped to the plot rect so zoomed-out data
            doesn't spill into the axis padding. */}
        <g clipPath="url(#chart-clip)">
          <path d={areaPath} fill="url(#g-balance)" />
          {segments.map((s, i) => (
            <path
              key={i}
              d={s.d}
              fill="none"
              stroke="#7dd3c0"
              strokeWidth="1.75"
              strokeDasharray={s.dashed ? '4 5' : undefined}
              strokeLinecap={s.dashed ? 'round' : undefined}
              filter={s.dashed ? undefined : 'url(#glow)'}
            />
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
                  <line
                    x1={m.cx}
                    y1={cyExpected}
                    x2={m.cx}
                    y2={cyActual}
                    stroke={color}
                    strokeDasharray="3 3"
                    strokeWidth="1"
                    opacity="0.8"
                  />
                )}
                {/* Diamond = rotated 4-sided path centered on (m.cx, cyExpected) */}
                <path
                  d={`M ${m.cx} ${cyExpected - 5} L ${m.cx + 5} ${cyExpected} L ${m.cx} ${cyExpected + 5} L ${m.cx - 5} ${cyExpected} Z`}
                  fill={fill}
                  stroke={color}
                  strokeWidth="2"
                />
                {m.drift && (
                  <circle cx={m.cx} cy={cyActual} r="2" fill={color} />
                )}
              </g>
            );
          })}

          {/* end marker */}
          <circle cx={xScaleAt(data.length - 1)} cy={yScale(last.value)} r="3.5" fill="#7dd3c0" />
          <circle cx={xScaleAt(data.length - 1)} cy={yScale(last.value)} r="7" fill="#7dd3c0" opacity="0.18" />

          {/* hover guide + highlighted dot */}
          {hover !== null && drag === null && (
            <g pointerEvents="none">
              <line
                x1={xScaleAt(hover.idx)}
                y1={pad.top}
                x2={xScaleAt(hover.idx)}
                y2={pad.top + innerH}
                stroke="#5b6478"
                strokeDasharray="3 4"
                strokeWidth="1"
              />
              <circle
                cx={xScaleAt(hover.idx)}
                cy={yScale(data[hover.idx]!.value)}
                r="5"
                fill="#0b0d11"
                stroke="#7dd3c0"
                strokeWidth="2"
              />
            </g>
          )}

          {/* Live brush selection */}
          {dragRect && (
            <rect
              x={dragRect.x}
              y={pad.top}
              width={dragRect.width}
              height={innerH}
              fill="#7dd3c0"
              opacity="0.14"
              pointerEvents="none"
            />
          )}
        </g>

        {minY < 0 && maxY > 0 && (
          <text x={w - pad.right + 4} y={zeroY + 4} fill="#3a4252" fontSize="10" fontFamily="Fraunces Variable, serif" fontStyle="italic">
            0
          </text>
        )}
      </svg>

      {zoom !== null && (
        <button
          type="button"
          onClick={() => setZoom(null)}
          className="absolute top-2 right-2 text-[11px] text-ink-300 hover:text-ink-50 bg-ink-900/85 border border-ink-800 hover:border-ink-700 rounded-md px-2 py-1 transition"
          title={t('balanceChart.zoomReset.title')}
        >
          {t('balanceChart.zoomReset.button')}
        </button>
      )}

      {hover !== null && drag === null && hovered && (
        <BalanceTooltip
          hovered={hovered}
          hoveredCheckpoint={hoveredCheckpoint}
          currency={currency}
          x={hover.x}
          y={hover.y}
          containerWidth={containerRef.current?.clientWidth ?? 1000}
          previousValue={hover.idx > 0 ? data[hover.idx - 1]!.value : null}
        />
      )}
    </div>
  );
}
