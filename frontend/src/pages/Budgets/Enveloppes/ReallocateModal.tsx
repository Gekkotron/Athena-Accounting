import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { EnvelopeReportRow } from '../../../api/types';
import { parseDecimal } from '../../../lib/format';

export function ReallocateModal(props: {
  open: boolean;
  source: EnvelopeReportRow | null;
  rows: EnvelopeReportRow[];
  month: string;
  onClose: () => void;
  onConfirm: (payload: {
    fromCategoryId: number; toCategoryId: number; month: string; amount: string;
  }) => void;
}): JSX.Element | null {
  const { t } = useTranslation(['budgets', 'common']);
  const [toId, setToId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');

  if (!props.open || !props.source) return null;

  const parsedAmount = parseDecimal(amount);
  const parsedAmountNum = parsedAmount == null ? null : Number(parsedAmount);
  const disabled = !toId || toId === props.source.categoryId || parsedAmountNum == null || parsedAmountNum <= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm">
      <div className="surface p-6 w-full max-w-md flex flex-col gap-4">
        <h2 className="display text-lg">{t('envelopes.reallocateModal.title')}</h2>
        <div className="text-sm text-ink-400">
          <Trans t={t} i18nKey="envelopes.reallocateModal.from">
            From <b className="text-ink-100">{{ name: props.source.categoryName } as unknown as string}</b>
          </Trans>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span>{t('envelopes.reallocateModal.toLabel')}</span>
          <select
            className="input"
            value={toId ?? ''}
            onChange={(e) => setToId(Number(e.target.value) || null)}
          >
            <option value="">{t('envelopes.reallocateModal.selectPlaceholder')}</option>
            {props.rows
              .filter((r) => r.categoryId !== props.source!.categoryId)
              .map((r) => <option key={r.categoryId} value={r.categoryId}>{r.categoryName}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span>{t('envelopes.amountLabel')}</span>
          <input
            className="input"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={props.onClose}>{t('cancel', { ns: 'common' })}</button>
          <button
            className="btn-primary"
            disabled={disabled}
            onClick={() => props.onConfirm({
              fromCategoryId: props.source!.categoryId,
              toCategoryId: toId!,
              month: props.month,
              amount: parsedAmountNum!.toFixed(2),
            })}
          >{t('confirm', { ns: 'common' })}</button>
        </div>
      </div>
    </div>
  );
}
