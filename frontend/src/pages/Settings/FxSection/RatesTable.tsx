import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDecimal } from '../../../lib/format';

export interface FxRateWire {
  id: number;
  from: string;
  to: string;
  effectiveFrom: string;
  rate: string;
}

interface RatesTableProps {
  rates: FxRateWire[];
  onDelete: (id: number) => void;
  onEdit: (input: { id: number; rate: string; effectiveFrom: string }) => void;
}

// Mirrors the backend's GET /api/fx-rates sort: (from, to, effectiveFrom
// DESC). The API already returns rows in this order, but sorting here too
// keeps the table correct if it's ever fed an unsorted list directly.
function sortRates(rates: FxRateWire[]): FxRateWire[] {
  return [...rates].sort((a, b) =>
    a.from.localeCompare(b.from) ||
    a.to.localeCompare(b.to) ||
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
}

export function RatesTable({ rates, onDelete, onEdit }: RatesTableProps): JSX.Element {
  const { t } = useTranslation(['settings', 'common']);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftRate, setDraftRate] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  const sorted = sortRates(rates);

  function startEdit(row: FxRateWire) {
    setEditingId(row.id);
    setDraftRate(row.rate);
    setDraftDate(row.effectiveFrom);
    setDraftError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftError(null);
  }

  function saveEdit(id: number) {
    const parsed = parseDecimal(draftRate);
    if (parsed === null) {
      setDraftError(t('settings.fx.rates.invalidRate'));
      return;
    }
    onEdit({ id, rate: parsed, effectiveFrom: draftDate });
    setEditingId(null);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-400">
            <th className="py-1 pr-2 font-normal">{t('settings.fx.rates.columns.from')}</th>
            <th className="py-1 pr-2 font-normal">{t('settings.fx.rates.columns.to')}</th>
            <th className="py-1 pr-2 font-normal">{t('settings.fx.rates.columns.effectiveFrom')}</th>
            <th className="py-1 pr-2 font-normal">{t('settings.fx.rates.columns.rate')}</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const isEditing = editingId === row.id;
            return (
              <tr key={row.id} className="border-t border-ink-800/60">
                <td className="py-1.5 pr-2">{row.from}</td>
                <td className="py-1.5 pr-2">{row.to}</td>
                <td className="py-1.5 pr-2">
                  {isEditing ? (
                    <input
                      type="date"
                      className="input"
                      value={draftDate}
                      onChange={(e) => setDraftDate(e.target.value)}
                    />
                  ) : (
                    row.effectiveFrom
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  {isEditing ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      className="input"
                      value={draftRate}
                      onChange={(e) => setDraftRate(e.target.value)}
                    />
                  ) : (
                    row.rate
                  )}
                </td>
                <td className="py-1.5">
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <button type="button" className="btn-primary" onClick={() => saveEdit(row.id)}>
                          {t('common:save')}
                        </button>
                        <button type="button" className="btn-ghost" onClick={cancelEdit}>
                          {t('common:cancel')}
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn-ghost" onClick={() => startEdit(row)}>
                          {t('settings.fx.rates.edit')}
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => onDelete(row.id)}>
                          {t('settings.fx.rates.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editingId !== null && draftError && (
        <div className="mt-2 text-sm text-clay-300">{draftError}</div>
      )}
    </div>
  );
}
