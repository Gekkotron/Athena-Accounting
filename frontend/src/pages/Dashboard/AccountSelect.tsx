import { useTranslation } from 'react-i18next';
import type { Account } from '../../api/types';

interface Props {
  value: 'all' | 'available' | number;
  onChange: (v: 'all' | 'available' | number) => void;
  accounts: Account[];
  /** Currency shown next to "Tous les comptes" when the scope is 'all'. */
  primaryCurrency?: string;
  /** When true, hide the "All available accounts" option (e.g. when every
      account is already unlocked, so the option would be redundant with
      "All accounts"). Defaults to showing it. */
  hideAvailable?: boolean;
}

// Compact accounts dropdown mirroring the RangePicker chip aesthetic
// (rounded-lg, ink-800 border, ink-900/60 background, text-xs). Rendered
// once per chart card so the same page-wide scope is visible next to each
// chart's range picker.
export function AccountSelect({ value, onChange, accounts, primaryCurrency, hideAvailable }: Props): JSX.Element {
  const { t } = useTranslation('dashboard');
  const stringValue = value === 'all' || value === 'available' ? value : String(value);
  return (
    <select
      className="rounded-lg border border-ink-800 bg-ink-900/60 px-2.5 py-1.5 text-xs text-ink-100 focus:border-sage-300/50"
      value={stringValue}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === 'all' || v === 'available' ? v : Number(v));
      }}
      aria-label={t('accountSelect.ariaLabel')}
    >
      <option value="all">{t('accountSelect.allAccounts')}{primaryCurrency ? ` (${primaryCurrency})` : ''}</option>
      {!hideAvailable && (
        <option value="available">{t('accountSelect.availableAccounts')}</option>
      )}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} ({a.currency})
        </option>
      ))}
    </select>
  );
}
