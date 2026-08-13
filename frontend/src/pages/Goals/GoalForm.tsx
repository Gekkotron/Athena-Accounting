import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account, SavingsGoal } from '../../api/types';
import { parseDecimal } from '../../lib/format';

// Create/edit modal contents. Kept as a controlled form so the caller can
// wrap it in a modal chrome of its choice (dedicated page + AccountCard
// both use it). Not an <input type="number"> — that fights French-locale
// decimals; see feedback_french_decimal_inputs.
export function GoalForm({
  accounts,
  initial,
  defaultAccountId,
  submitting,
  serverError,
  onSubmit,
  onCancel,
}: {
  accounts: Account[];
  initial?: SavingsGoal | null;
  defaultAccountId?: number | null;
  submitting?: boolean;
  serverError?: string | null;
  onSubmit: (v: {
    accountId: number;
    name: string;
    targetAmount: string;
    targetDate: string | null;
    color: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('goals');
  const editing = !!initial;

  const [accountId, setAccountId] = useState<number>(
    initial?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? 0,
  );
  const [name, setName] = useState(initial?.name ?? '');
  const [targetRaw, setTargetRaw] = useState(initial ? initial.targetAmount : '');
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '');
  const [color, setColor] = useState(initial?.color ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const target = parseDecimal(targetRaw);
    if (!target || Number(target) <= 0) {
      setError(t('form.errorNamePositiveTarget'));
      return;
    }
    if (!name.trim()) return;
    setError(null);
    onSubmit({
      accountId,
      name: name.trim(),
      targetAmount: target,
      targetDate: targetDate || null,
      color: color || null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label block mb-1">{t('form.accountLabel')}</label>
        <select
          className="input w-full"
          value={accountId}
          onChange={(e) => setAccountId(Number(e.target.value))}
          disabled={editing}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="label block mb-1">{t('form.nameLabel')}</label>
        <input
          className="input w-full"
          value={name}
          placeholder={t('form.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          maxLength={128}
        />
      </div>
      <div>
        <label className="label block mb-1">{t('form.targetLabel')}</label>
        <input
          type="text"
          inputMode="decimal"
          className="input w-full tabular-nums"
          value={targetRaw}
          onChange={(e) => setTargetRaw(e.target.value)}
          placeholder="1000,00"
        />
      </div>
      <div>
        <label className="label block mb-1">{t('form.targetDateLabel')}</label>
        <input
          type="date"
          className="input w-full"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
        />
      </div>
      <div>
        <label className="label block mb-1">{t('form.colorLabel')}</label>
        <input
          type="color"
          className="input w-16 h-9 p-0.5"
          value={color || '#94a3b8'}
          onChange={(e) => setColor(e.target.value)}
        />
      </div>
      {(error || serverError) && (
        <div className="text-xs text-clay-300" role="alert">{error ?? serverError}</div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('form.cancel')}
        </button>
        <button type="submit" className="btn-primary" disabled={submitting || !name.trim()}>
          {editing ? t('form.submitUpdate') : t('form.submitCreate')}
        </button>
      </div>
    </form>
  );
}
