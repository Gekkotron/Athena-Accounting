import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDecimal } from '../../../lib/format';

export function HoldModal(props: {
  open: boolean;
  month: string;
  poolAvailable: string;
  onClose: () => void;
  onConfirm: (payload: { month: string; amount: string }) => void;
}): JSX.Element | null {
  const { t } = useTranslation(['budgets', 'common']);
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (props.open) setAmount('');
  }, [props.open]);

  if (!props.open) return null;
  const parsed = parseDecimal(amount);
  const parsedNum = parsed == null ? null : Number(parsed);
  const disabled = parsedNum == null || parsedNum < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm">
      <div className="surface p-6 w-full max-w-md flex flex-col gap-4">
        <h2 className="display text-lg">{t('envelopes.holdModal.title')}</h2>
        <div className="flex items-center gap-2">
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setAmount('0,00')}>0</button>
          <button
            className="btn-ghost !py-1 !px-2 text-xs"
            onClick={() => setAmount(props.poolAvailable.replace('.', ','))}
          >
            {t('envelopes.holdModal.presetAll')}
          </button>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>{t('envelopes.amountLabel')}</span>
          <input
            className="input" type="text" inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={props.onClose}>{t('cancel', { ns: 'common' })}</button>
          <button
            className="btn-primary"
            disabled={disabled}
            onClick={() => props.onConfirm({ month: props.month, amount: parsedNum!.toFixed(2) })}
          >
            {t('envelopes.holdModal.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
