import { HORIZONS, type Horizon } from './forecast-lib';

export function ForecastHorizonPicker({
  value,
  onChange,
}: {
  value: Horizon;
  onChange: (v: Horizon) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-ink-800/70 p-0.5 text-xs">
      {HORIZONS.map((h) => (
        <button
          key={h}
          type="button"
          onClick={() => onChange(h)}
          className={`px-2 py-1 rounded-md transition ${
            value === h ? 'bg-ink-800 text-ink-50' : 'text-ink-400 hover:text-ink-100'
          }`}
        >
          J+{h}
        </button>
      ))}
    </div>
  );
}
