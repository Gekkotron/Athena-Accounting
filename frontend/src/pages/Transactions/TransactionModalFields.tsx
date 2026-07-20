import { useTranslation } from 'react-i18next';
import type { Account, Category } from '../../api/types';
import { formatCategoryPath } from '../../lib/categories';
import { sortCategoriesForPicker } from './lib';

interface Props {
  accounts: Account[];
  categories: Category[];
  categoryById: Map<number, Category>;
  accountId: number | '';
  onAccountIdChange: (id: number | '') => void;
  date: string;
  onDateChange: (v: string) => void;
  amount: string;
  onAmountChange: (v: string) => void;
  rawLabel: string;
  onRawLabelChange: (v: string) => void;
  categoryId: number | '';
  onCategoryIdChange: (id: number | '') => void;
  notes: string;
  onNotesChange: (v: string) => void;
  lockYearsInput: string;
  onLockYearsInputChange: (v: string) => void;
  selectedAccountLockYears: number | null | undefined;
}

// Field grid for TransactionModal: account, date, amount, label, category,
// notes, lockYears. Pure presentational — the parent owns state, validation,
// and submit. Split out so the modal composer stays under 300 lines.
export function TransactionModalFields({
  accounts,
  categories,
  categoryById,
  accountId,
  onAccountIdChange,
  date,
  onDateChange,
  amount,
  onAmountChange,
  rawLabel,
  onRawLabelChange,
  categoryId,
  onCategoryIdChange,
  notes,
  onNotesChange,
  lockYearsInput,
  onLockYearsInputChange,
  selectedAccountLockYears,
}: Props): JSX.Element {
  const { t } = useTranslation('transactions');
  const sortedCategories = sortCategoriesForPicker(categories, categoryById);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <label className="label mb-1.5 block">{t('modal.labels.account')}</label>
        <select
          className="input"
          value={accountId}
          onChange={(e) => onAccountIdChange(e.target.value ? Number(e.target.value) : '')}
          required
        >
          <option value="">—</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('modal.labels.date')}</label>
        <input
          type="text"
          inputMode="numeric"
          className="input font-mono"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          placeholder={t('modal.placeholders.date')}
          required
          autoComplete="off"
        />
        <div className="text-[11px] text-ink-500 mt-1">
          {t('modal.hints.dateFormat')}
        </div>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('modal.labels.amount')}</label>
        <input
          className="input font-mono"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder={t('modal.placeholders.amount')}
          required
        />
        <div className="text-[11px] text-ink-500 mt-1">
          {t('modal.hints.amountSign')}
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className="label mb-1.5 block">{t('modal.labels.label')}</label>
        <input
          className="input"
          value={rawLabel}
          onChange={(e) => onRawLabelChange(e.target.value)}
          placeholder={t('modal.placeholders.label')}
          required
        />
      </div>
      <div>
        <label className="label mb-1.5 block">{t('modal.labels.categoryOptional')}</label>
        <select
          className="input"
          value={categoryId}
          onChange={(e) => onCategoryIdChange(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">{t('modal.options.categoryAuto')}</option>
          {sortedCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {formatCategoryPath(c, categoryById)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label mb-1.5 block">{t('modal.labels.notes')}</label>
        <input
          className="input"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="…"
        />
      </div>
      <div className="sm:col-span-2">
        <label
          className="label mb-1.5 block"
          title={t('modal.hints.lockYearsTooltip')}
        >
          {t('modal.labels.lockYears')} <span className="text-ink-500 font-normal">{t('modal.labels.optional')}</span>
        </label>
        <input
          inputMode="numeric"
          className="input font-mono"
          value={lockYearsInput}
          onChange={(e) => onLockYearsInputChange(e.target.value)}
          placeholder="—"
        />
        <div className="text-[11px] text-ink-500 mt-1">
          {selectedAccountLockYears == null
            ? t('modal.hints.lockYearsNoAccountLock')
            : t('modal.hints.lockYearsWithAccountLock', { years: selectedAccountLockYears })}
        </div>
      </div>
    </div>
  );
}
