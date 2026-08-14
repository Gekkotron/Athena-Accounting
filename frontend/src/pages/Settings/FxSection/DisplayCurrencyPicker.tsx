import { useTranslation } from 'react-i18next';

interface DisplayCurrencyPickerProps {
  currencies: string[];
  value: string | null;
  onChange: (value: string | null) => void;
}

// Sentinel <option> value for "no display currency" — null can't be an
// <option value>, so it's mapped to this string on the way in and back to
// null on the way out.
const NONE = '__none__';

export function DisplayCurrencyPicker({
  currencies,
  value,
  onChange,
}: DisplayCurrencyPickerProps): JSX.Element {
  const { t } = useTranslation('settings');
  return (
    <div>
      <label htmlFor="fx-display-currency" className="label mb-1.5 block">
        {t('settings.fx.displayCurrency.label')}
      </label>
      <select
        id="fx-display-currency"
        className="input"
        value={value ?? NONE}
        onChange={(e) => onChange(e.target.value === NONE ? null : e.target.value)}
      >
        <option value={NONE}>{t('settings.fx.displayCurrency.none')}</option>
        {currencies.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
