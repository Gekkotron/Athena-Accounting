import { useTranslation } from 'react-i18next';

export function AccountFilter(props: {
  accountId: number | null;
  accounts: { id: number; name: string }[];
  onChange: (id: number | null) => void;
}): JSX.Element {
  const { t } = useTranslation('budgets');
  const { accountId, accounts, onChange } = props;
  return (
    <label className="flex items-center gap-2 text-sm text-ink-400">
      <span>{t('accountFilter.label')}</span>
      <select
        className="input !py-1"
        value={accountId ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{t('accountFilter.all')}</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );
}
