interface SparklineProps {
  values: number[];
  color?: string | null;
  width?: number;
  height?: number;
  'aria-label'?: string;
}

const PAD = 2;

// Tiny inline-SVG trend line. Presentational only — no data logic, no state.
// Scales values into the box: max → top, min → bottom, flat series → centered.
export function Sparkline({
  values,
  color,
  width = 72,
  height = 20,
  'aria-label': ariaLabel,
}: SparklineProps): JSX.Element {
  const stroke = color ?? 'currentColor';
  const labelProps = ariaLabel
    ? { role: 'img', 'aria-label': ariaLabel }
    : { 'aria-hidden': true };

  const n = values.length;
  const svgProps = {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    className: color ? '' : 'text-ink-500',
    ...labelProps,
  };

  if (n === 0) {
    return <svg {...svgProps} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  const y = (v: number) =>
    flat ? height / 2 : height - PAD - ((v - min) / (max - min)) * (height - 2 * PAD);
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);

  if (n === 1) {
    return (
      <svg {...svgProps}>
        <circle cx={x(0)} cy={y(values[0])} r={2} fill={stroke} />
      </svg>
    );
  }

  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg {...svgProps}>
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
