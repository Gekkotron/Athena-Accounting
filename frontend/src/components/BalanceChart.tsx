import { useMemo } from 'react';
import type { BalancePoint } from '../api/types';
import { formatAmount } from '../lib/format';

interface Props {
  points: BalancePoint[];
  currency: string;
  height?: number;
}

// Minimal SVG line chart — sums cumulative across accounts of the same currency
// and renders a single path. Hover dots/tooltips skipped for v1; the dashboard
// reads this as a "shape of my money over time" indicator, not an analyst's
// canvas.
export function BalanceChart({ points, currency, height = 200 }: Props) {
  const data = useMemo(() => {
    // Build a sorted list of dates; for each date, sum cumulative across
    // accounts that share `currency`.
    const byDate = new Map<string, number>();
    for (const p of points) {
      if (p.currency !== currency) continue;
      const v = Number(p.cumulative);
      if (!Number.isFinite(v)) continue;
      byDate.set(p.bucket, (byDate.get(p.bucket) ?? 0) + v);
    }
    const arr = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
    return arr;
  }, [points, currency]);

  if (data.length < 2) {
    return (
      <div className="text-sm text-slate-500 py-8 text-center">
        Pas encore assez de données pour tracer une courbe.
      </div>
    );
  }

  const w = 800;
  const h = height;
  const pad = { top: 16, right: 16, bottom: 24, left: 56 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const ys = data.map((d) => d.value);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const range = maxY - minY || 1;

  const xScale = (i: number) => pad.left + (i / (data.length - 1)) * innerW;
  const yScale = (v: number) => pad.top + innerH - ((v - minY) / range) * innerH;

  const path = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(d.value).toFixed(1)}`)
    .join(' ');

  const areaPath = `${path} L ${xScale(data.length - 1).toFixed(1)} ${(pad.top + innerH).toFixed(1)} L ${xScale(0).toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;

  const ticks = 4;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => minY + (range * i) / ticks);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ maxWidth: '100%', height }}>
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>

        {tickValues.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              y1={yScale(t)}
              x2={w - pad.right}
              y2={yScale(t)}
              stroke="#1e293b"
              strokeDasharray="2 4"
            />
            <text x={pad.left - 8} y={yScale(t) + 4} fill="#64748b" fontSize="10" textAnchor="end">
              {formatAmount(t, currency)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#g)" />
        <path d={path} fill="none" stroke="#34d399" strokeWidth="1.6" />
      </svg>
    </div>
  );
}
