import { normalizeSparkline } from './budget-math';

export function Sparkline(props: {
  values: string[];
  state?: 'over' | 'onTrack' | 'unknown';
}): JSX.Element {
  const bars = normalizeSparkline(props.values);
  if (bars.length === 0) return <div className="w-16 h-4" aria-hidden="true" />;
  const currentColor = props.state === 'over' ? 'fill-clay-400'
                     : props.state === 'onTrack' ? 'fill-sage-400'
                     : 'fill-ink-400';
  return (
    <svg viewBox="0 0 100 20" className="w-16 h-4" preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => (
        <rect
          key={i}
          x={i * (100 / bars.length) + 0.5}
          y={20 - b.height * 18}
          width={100 / bars.length - 1}
          height={Math.max(1, b.height * 18)}
          className={b.isCurrent ? currentColor : 'fill-ink-600'}
          rx="1"
        />
      ))}
    </svg>
  );
}
