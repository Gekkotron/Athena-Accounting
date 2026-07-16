import { useTranslation } from 'react-i18next';
import type { Account } from '../../api/types';

interface Props {
  value: 'all' | number;
  onChange: (v: 'all' | number) => void;
  accounts: Account[];
  /** Currency shown next to "Tous les comptes" when the scope is 'all'. */
  primaryCurrency?: string;
}

// Compact accounts dropdown mirroring the RangePicker chip aesthetic
// (rounded-lg, ink-800 border, ink-900/60 background, text-xs). Rendered
// once per chart card so the same page-wide scope is visible next to each
// chart's range picker.
export function AccountSelect({ value, onChange, accounts, primaryCurrency }: Props): JSX.Element {
  const { t } = useTranslation('dashboard');
  return (
    <select
      className="rounded-lg border border-ink-800 bg-ink-900/60 px-2.5 py-1.5 text-xs text-ink-100 focus:border-sage-300/50"
      value={value === 'all' ? 'all' : String(value)}
      onChange={(e) => onChange(e.target.value === 'all' ? 'all' : Number(e.target.value))}
      aria-label={t('accountSelect.ariaLabel')}
    >
      <option value="all">{t('accountSelect.allAccounts')}{primaryCurrency ? ` (${primaryCurrency})` : ''}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name} ({a.currency})
        </option>
      ))}
    </select>
  );
}
