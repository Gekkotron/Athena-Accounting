import { useTranslation } from 'react-i18next';

export function FieldError({ k }: { k?: string }) {
  const { t } = useTranslation('loans');
  if (!k) return null;
  return <div role="alert" className="text-[11px] text-clay-300 mt-1">{t(k)}</div>;
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
  type?: 'text' | 'date' | 'month';
  placeholder?: string;
}

// Text input only — never type="number" (French decimal commas).
export function TextField({ id, label, value, onChange, error, inputMode = 'text', type = 'text', placeholder }: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="label block mb-1">{label}</label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`input w-full ${inputMode === 'text' ? '' : 'tabular-nums'}`}
      />
      <FieldError k={error} />
    </div>
  );
}

interface SelectFieldProps<T extends string> {
  id: string;
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}

export function SelectField<T extends string>({ id, label, value, options, onChange }: SelectFieldProps<T>) {
  return (
    <div>
      <label htmlFor={id} className="label block mb-1">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className="input w-full">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
