import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function SavedChip() {
  const { t } = useTranslation('settings');
  return (
    <span className="text-[10px] uppercase tracking-wide text-sage-300 ml-2">{t('settings.savedChip')}</span>
  );
}

// Blur-committed integer input. Local state so keystrokes don't PATCH.
export function NumberField(props: {
  label: string;
  help: string;
  min: number;
  max: number;
  value: number;
  suffix?: string;
  flashing: boolean;
  onCommit: (v: number) => void;
}) {
  const { label, help, min, max, value, suffix, flashing, onCommit } = props;
  const [local, setLocal] = useState<string>(String(value));
  const initial = useRef(value);
  useEffect(() => {
    // Re-sync when the server value changes underneath us (invalidate/refetch).
    if (value !== initial.current) {
      setLocal(String(value));
      initial.current = value;
    }
  }, [value]);

  const commit = () => {
    const n = Number.parseInt(local, 10);
    if (!Number.isFinite(n) || n < min || n > max || n === value) {
      setLocal(String(value));
      return;
    }
    onCommit(n);
  };

  return (
    <div>
      <label className="text-sm mb-1 block">
        {label}
        {flashing && <SavedChip />}
      </label>
      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          className="input w-28"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label={label}
        />
        {suffix && <span className="text-sm text-ink-400">{suffix}</span>}
      </div>
      <p className="text-xs text-ink-500 mt-1">{help}</p>
    </div>
  );
}
