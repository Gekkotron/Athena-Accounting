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

export type SelectOption = { value: string; label: string };

// Sibling of NumberField for label+select pairs. Settings values that aren't
// pure strings (numeric account ids, discriminated unions like 'all' /
// 'first-checking' / <id>) serialize to string at the DOM boundary; callers
// do their own parse on the way out so the primitive stays single-shape.
export function SelectField(props: {
  label: string;
  help?: string;
  value: string;
  options: ReadonlyArray<SelectOption>;
  flashing: boolean;
  onChange: (v: string) => void;
}) {
  const { label, help, value, options, flashing, onChange } = props;
  return (
    <div>
      <label className="text-sm mb-1 block">
        {label}
        {flashing && <SavedChip />}
      </label>
      <select
        className="input"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <p className="text-xs text-ink-500 mt-1">{help}</p>}
    </div>
  );
}
