import { useEffect, useState } from 'react';
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
  onDeleteTarget: (categoryId: number) => void;
}): JSX.Element | null {
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
        <h2 className="display text-lg">Réglages · {row.categoryName}</h2>

        <label className="flex flex-col gap-1 text-sm">
          <span>Objectif</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as TargetKind | '')}>
            <option value="">Aucun</option>
            <option value="save_by_date">Économiser d'ici une date</option>
            <option value="monthly_recurring">Mensuel récurrent</option>
            <option value="save_up_to">Économiser jusqu'à</option>
          </select>
        </label>

        {kind !== '' && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span>Montant</span>
              <input className="input" type="text" inputMode="decimal"
                     value={amount} onChange={(e) => setAmount(e.target.value)}
                     placeholder="0,00" />
            </label>
            {kind === 'save_by_date' && (
              <label className="flex flex-col gap-1 text-sm">
                <span>Échéance</span>
                <input className="input" type="date"
                       value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            )}
          </>
        )}

        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="label">Dépassement</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="policy" value="rollover_negative"
                   checked={policy === 'rollover_negative'}
                   onChange={() => setPolicy('rollover_negative')} />
            Report du solde négatif
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="policy" value="reallocate_manual"
                   checked={policy === 'reallocate_manual'}
                   onChange={() => setPolicy('reallocate_manual')} />
            Réaffectation manuelle (absorbé par le pool)
          </label>
        </fieldset>

        <div className="flex justify-between gap-2">
          {row.target && (
            <button className="btn-ghost text-clay-300"
                    onClick={() => props.onDeleteTarget(row.categoryId)}>
              Supprimer l'objectif
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={props.onClose}>Annuler</button>
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
            >Enregistrer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
