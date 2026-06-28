import { useMemo } from 'react';
import type { BalancePoint } from '../api/types';
import { formatAmountCompact, formatDateShort } from '../lib/format';

interface Props {
  points: BalancePoint[];
  currency: string;
  height?: number;
}

export function BalanceChart({ points, currency, height = 240 }: Props) {
  const data = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const p of points) {
      if (p.currency !== currency) continue;
      const v = Number(p.cumulative);
      if (!Number.isFinite(v)) continue;
      byDate.set(p.bucket, (byDate.get(p.bucket) ?? 0) + v);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
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

  // x-axis ticks: pick ~6 evenly spaced labels
  const xTickCount = Math.min(6, data.length);
  const xTickIdx = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i * (data.length - 1)) / Math.max(1, xTickCount - 1)),
  );

  const zeroY = yScale(0);
  const last = data[data.length - 1]!;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className="w-full" style={{ height }}>
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

        {/* zero line annotation */}
        {minY < 0 && maxY > 0 && (
          <text x={w - pad.right + 4} y={zeroY + 4} fill="#3a4252" fontSize="10" fontFamily="Fraunces Variable, serif" fontStyle="italic">
            0
          </text>
        )}
      </svg>
    </div>
  );
}
