import { useMemo, useRef, useState } from 'react';
import type { BalancePoint } from '../api/types';
import { formatAmount, formatAmountCompact, formatDate, formatDateShort } from '../lib/format';

interface Props {
  points: BalancePoint[];
  currency: string;
  height?: number;
}

interface HoverState {
  idx: number;
  // Container-relative coordinates of the data point, used to absolutely
  // position the HTML tooltip so it tracks the point even when the SVG is
  // scaled to fit different container widths.
  x: number;
  y: number;
}

export function BalanceChart({ points, currency, height = 240 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const data = useMemo(() => {
    // /api/reports/timeseries returns one row per (account, date-bucket) only
    // when that account had activity on that bucket. Naively summing per date
    // skips accounts that didn't move on that day, dragging the multi-account
    // total artificially toward zero. We forward-fill each account's last
    // known `cumulative` so the sum at any date includes every account.

    const filtered = points.filter(
      (p) => p.currency === currency && Number.isFinite(Number(p.cumulative)),
    );
    if (filtered.length === 0) return [];

    const allDates = Array.from(new Set(filtered.map((p) => p.bucket))).sort();
    const accountIds = Array.from(new Set(filtered.map((p) => p.account_id)));

    // Per-account, chronologically sorted points.
    const seriesByAccount = new Map<number, { bucket: string; cumulative: number }[]>();
    for (const accId of accountIds) {
      const rows = filtered
        .filter((p) => p.account_id === accId)
        .map((p) => ({ bucket: p.bucket, cumulative: Number(p.cumulative) }))
        .sort((a, b) => a.bucket.localeCompare(b.bucket));
      seriesByAccount.set(accId, rows);
    }

    // Walk the union of dates in order, advancing each account's pointer
    // through its own series and carrying its last seen cumulative forward.
    const pointers = new Map<number, number>(accountIds.map((id) => [id, 0]));
    const carries = new Map<number, number>(accountIds.map((id) => [id, 0]));

    const out: { date: string; value: number }[] = [];
    for (const date of allDates) {
      let total = 0;
      for (const accId of accountIds) {
        const series = seriesByAccount.get(accId)!;
        let ptr = pointers.get(accId)!;
        let carry = carries.get(accId)!;
        while (ptr < series.length && series[ptr]!.bucket <= date) {
          carry = series[ptr]!.cumulative;
          ptr++;
        }
        pointers.set(accId, ptr);
        carries.set(accId, carry);
        total += carry;
      }
      out.push({ date, value: total });
    }

    return out;
  }, [points, currency]);

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

  const path = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(d.value).toFixed(1)}`)
    .join(' ');

  const areaPath = `${path} L ${xScale(data.length - 1).toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${xScale(0).toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;

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
        <path d={path} fill="none" stroke="#7dd3c0" strokeWidth="1.75" filter="url(#glow)" />

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

      {/* HTML tooltip — position absolute relative to the container, snapped
          to the data point. -translate-x-1/2 + -translate-y-full + -mt-3 puts
          it just above the dot, centered horizontally. The container also
          clamps the X so the tooltip never overflows on the sides. */}
      {hover !== null && hovered && (
        <div
          className="absolute pointer-events-none surface px-3 py-2 shadow-card min-w-[140px]"
          style={{
            left: clamp(hover.x, 80, (containerRef.current?.clientWidth ?? 1000) - 80),
            top: hover.y,
            transform: 'translate(-50%, calc(-100% - 14px))',
          }}
        >
          <div className="font-mono text-[10px] text-ink-500 mb-0.5">
            {formatDate(hovered.date)}
          </div>
          <div className={`font-mono text-sm tabular-nums ${hovered.value < 0 ? 'text-clay-300' : hovered.value > 0 ? 'text-sage-300' : 'text-ink-300'}`}>
            {formatAmount(hovered.value, currency)}
          </div>
        </div>
      )}
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
