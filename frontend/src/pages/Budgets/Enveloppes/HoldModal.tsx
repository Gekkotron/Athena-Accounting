import { useEffect, useState } from 'react';
import { parseDecimal } from '../../../lib/format';

export function HoldModal(props: {
  open: boolean;
  month: string;
  poolAvailable: string;
  onClose: () => void;
  onConfirm: (payload: { month: string; amount: string }) => void;
}): JSX.Element | null {
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
        <h2 className="display text-lg">Retenir pour le mois prochain</h2>
        <div className="flex items-center gap-2">
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => setAmount('0,00')}>0</button>
          <button
            className="btn-ghost !py-1 !px-2 text-xs"
            onClick={() => setAmount(props.poolAvailable.replace('.', ','))}
          >
            Tout
          </button>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span>Montant</span>
          <input
            className="input" type="text" inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={props.onClose}>Annuler</button>
          <button
            className="btn-primary"
            disabled={disabled}
            onClick={() => props.onConfirm({ month: props.month, amount: parsedNum!.toFixed(2) })}
          >
            Retenir
          </button>
        </div>
      </div>
    </div>
  );
}
