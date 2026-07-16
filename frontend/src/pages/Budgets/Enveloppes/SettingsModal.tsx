import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EnvelopeReportRow, TargetKind, OverspendPolicy } from '../../../api/types';
import { parseDecimal } from '../../../lib/format';

export function SettingsModal(props: {
  open: boolean;
  row: EnvelopeReportRow | null;
  onClose: () => void;
  onSave: (args: {
    categoryId: number;
    body: {
      targetAmount: string | null;
      targetDate: string | null;
      targetKind: TargetKind | null;
      overspendPolicy: OverspendPolicy;
    };
  }) => void;
}): JSX.Element | null {
  const { t } = useTranslation(['budgets', 'common']);
  const row = props.row;
  const [kind, setKind] = useState<TargetKind | ''>('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [policy, setPolicy] = useState<OverspendPolicy>('rollover_negative');

  useEffect(() => {
    if (!row) return;
    setKind(row.target?.kind ?? '');
    setAmount(row.target?.amount ? row.target.amount.replace('.', ',') : '');
    setDate(row.target?.date ?? '');
    setPolicy(row.overspendPolicy);
  }, [row]);

  if (!props.open || !row) return null;

  const parsedAmount = parseDecimal(amount);
  const parsedAmountNum = parsedAmount == null ? null : Number(parsedAmount);
  const canSave = kind === '' || (parsedAmountNum != null && parsedAmountNum > 0);

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/70 flex items-center justify-center p-4">
      <div className="surface p-6 w-full max-w-md flex flex-col gap-4">
        <h2 className="display text-lg">{t('envelopes.settingsModal.title', { name: row.categoryName })}</h2>

        <label className="flex flex-col gap-1 text-sm">
          <span>{t('envelopes.settingsModal.targetLabel')}</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TargetKind | '')}>
            <option value="">{t('envelopes.settingsModal.targetNone')}</option>
            <option value="save_by_date">{t('envelopes.settingsModal.targetSaveByDate')}</option>
            <option value="monthly_recurring">{t('envelopes.settingsModal.targetMonthlyRecurring')}</option>
            <option value="save_up_to">{t('envelopes.settingsModal.targetSaveUpTo')}</option>
          </select>
        </label>

        {kind !== '' && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t('envelopes.amountLabel')}</span>
              <input className="input" type="text" inputMode="decimal"
                     value={amount} onChange={(e) => setAmount(e.target.value)}
                     placeholder="0,00" />
            </label>
            {kind === 'save_by_date' && (
              <label className="flex flex-col gap-1 text-sm">
                <span>{t('envelopes.settingsModal.dateLabel')}</span>
                <input className="input" type="date"
                       value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            )}
          </>
        )}

        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="label">{t('envelopes.settingsModal.overspendLegend')}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="policy" value="rollover_negative"
                   checked={policy === 'rollover_negative'}
                   onChange={() => setPolicy('rollover_negative')} />
            {t('envelopes.settingsModal.policyRollover')}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="policy" value="reallocate_manual"
                   checked={policy === 'reallocate_manual'}
                   onChange={() => setPolicy('reallocate_manual')} />
            {t('envelopes.settingsModal.policyReallocate')}
          </label>
        </fieldset>

        <div className="flex justify-between gap-2">
          {row.target && (
            <button className="btn-ghost text-clay-300"
                    onClick={() => props.onSave({
                      categoryId: row.categoryId,
                      body: {
                        targetAmount: null,
                        targetDate: null,
                        targetKind: null,
                        overspendPolicy: policy,
                      },
                    })}>
              {t('envelopes.settingsModal.deleteTarget')}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={props.onClose}>{t('cancel', { ns: 'common' })}</button>
            <button
              className="btn-primary"
              disabled={!canSave}
              onClick={() => props.onSave({
                categoryId: row.categoryId,
                body: {
                  targetAmount: kind === '' ? null : parsedAmountNum!.toFixed(2),
                  targetDate: kind === 'save_by_date' ? (date || null) : null,
                  targetKind: kind === '' ? null : kind,
                  overspendPolicy: policy,
                },
              })}
            >{t('save', { ns: 'common' })}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
