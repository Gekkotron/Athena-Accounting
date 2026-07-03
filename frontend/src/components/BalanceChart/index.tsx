import { useMemo, useRef, useState } from 'react';
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
}

interface HoverState {
  idx: number;
  // Container-relative coordinates of the data point, used to absolutely
  // position the HTML tooltip so it tracks the point even when the SVG is
  // scaled to fit different container widths.
  x: number;
  y: number;
}

export function BalanceChart({ points, currency, height = 240, checkpoints }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const data = useMemo(() => buildAggregatedSeries(points, currency), [points, currency]);

  if (data.length < 2) {
    return (
      <div className="text-sm text-ink-500 py-12 text-center font-display italic">
        Pas encore assez de données pour tracer une courbe.
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

  const xScale = (i: number) => pad.left + (i / (data.length - 1)) * innerW;
  const yScale = (v: number) => pad.top + innerH - ((v - minY) / range) * innerH;

  const marks = buildCheckpointMarks(data, checkpoints, xScale);

  const path = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(d.value).toFixed(1)}`)
    .join(' ');

  const areaPath = `${path} L ${xScale(data.length - 1).toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${xScale(0).toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;

  // Split the stroked line into runs of consecutive segments sharing the same
  // "dashed" verdict. A segment is dashed when the two data points bracket a
  // gap of more than MAX_SOLID_GAP_DAYS — telling the user that we have no
  // data for that stretch (missed import, ingestion gap, …). Threshold is 6
  // days so weekends, short holidays, and a quiet week don't trigger a false
  // "missing data" signal. The area path stays continuous — the dotted stroke
  // alone communicates the uncertainty.
  const MAX_SOLID_GAP_DAYS = 6;
  const segments: { d: string; dashed: boolean }[] = [];
  {
    let runStart = 0;
    let runDashed: boolean | null = null;
    for (let i = 1; i < data.length; i++) {
      const gap = Math.round(
        (Date.parse(data[i]!.date) - Date.parse(data[i - 1]!.date)) / 86_400_000,
      );
      const dashed = gap > MAX_SOLID_GAP_DAYS;
      if (runDashed === null) {
        runDashed = dashed;
        continue;
      }
      if (dashed !== runDashed) {
        segments.push({
          d: data
            .slice(runStart, i)
            .map((p, k) => `${k === 0 ? 'M' : 'L'} ${xScale(runStart + k).toFixed(1)} ${yScale(p.value).toFixed(1)}`)
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
        .map((p, k) => `${k === 0 ? 'M' : 'L'} ${xScale(runStart + k).toFixed(1)} ${yScale(p.value).toFixed(1)}`)
        .join(' '),
      dashed: runDashed ?? false,
    });
  }

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => minY + (range * i) / ticks);
  const xTickCount = Math.min(6, data.length);
  const xTickIdx = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i * (data.length - 1)) / Math.max(1, xTickCount - 1)),
  );

  const zeroY = yScale(0);
  const last = data[data.length - 1]!;

  // Mousemove handler — pin to the closest data point in viewBox space, then
  // convert that snap-back point into container-relative screen coords so the
  // HTML tooltip lands exactly on it.
  const onMove = (e: React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;
    const svgRect = svg.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const xInSvg = e.clientX - svgRect.left;
    const xInViewBox = (xInSvg / svgRect.width) * w;

    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const dist = Math.abs(xScale(i) - xInViewBox);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }

    const px = (xScale(closest) / w) * svgRect.width;
    const py = (yScale(data[closest]!.value) / h) * svgRect.height;

    setHover({
      idx: closest,
      x: svgRect.left - containerRect.left + px,
      y: svgRect.top - containerRect.top + py,
    });
  };

  const onLeave = () => setHover(null);

  const hovered = hover !== null ? data[hover.idx] : null;

  // If the hovered X is within ~6 viewBox units of a checkpoint's X, show
  // the expected/actual/delta line in the tooltip. Kept tight (was 12) so
  // the drift readout doesn't misleadingly appear over neighbouring buckets
  // that have nothing to do with the checkpoint — the tooltip's date row
  // shows the hovered bucket's date, so a loose proximity gave the false
  // impression that the écart "belonged" to many nearby dates.
  const HOVER_PROXIMITY_VB = 6;
  const hoveredCheckpoint = (() => {
    if (hover === null) return null;
    const hoveredX = xScale(hover.idx);
    let closest: (typeof marks)[number] | null = null;
    let closestDist = Infinity;
    for (const m of marks) {
      const d = Math.abs(m.cx - hoveredX);
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
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
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

        {/* x-axis labels */}
        {xTickIdx.map((idx, i) => (
          <text
            key={i}
            x={xScale(idx)}
            y={h - 10}
            fill="#5b6478"
            fontSize="10"
            textAnchor="middle"
            fontFamily="JetBrains Mono Variable, monospace"
          >
            {formatDateShort(data[idx]!.date)}
          </text>
        ))}

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
        <circle cx={xScale(data.length - 1)} cy={yScale(last.value)} r="3.5" fill="#7dd3c0" />
        <circle cx={xScale(data.length - 1)} cy={yScale(last.value)} r="7" fill="#7dd3c0" opacity="0.18" />

        {minY < 0 && maxY > 0 && (
          <text x={w - pad.right + 4} y={zeroY + 4} fill="#3a4252" fontSize="10" fontFamily="Fraunces Variable, serif" fontStyle="italic">
            0
          </text>
        )}

        {/* hover guide + highlighted dot */}
        {hover !== null && (
          <g pointerEvents="none">
            <line
              x1={xScale(hover.idx)}
              y1={pad.top}
              x2={xScale(hover.idx)}
              y2={pad.top + innerH}
              stroke="#5b6478"
              strokeDasharray="3 4"
              strokeWidth="1"
            />
            <circle
              cx={xScale(hover.idx)}
              cy={yScale(data[hover.idx]!.value)}
              r="5"
              fill="#0b0d11"
              stroke="#7dd3c0"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {hover !== null && hovered && (
        <BalanceTooltip
          hovered={hovered}
          hoveredCheckpoint={hoveredCheckpoint}
          currency={currency}
          x={hover.x}
          y={hover.y}
          containerWidth={containerRef.current?.clientWidth ?? 1000}
        />
      )}
    </div>
  );
}
