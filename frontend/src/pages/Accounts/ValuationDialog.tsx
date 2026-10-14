import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Account } from '../../api/types';
import { deleteValuation, listValuations, upsertValuation } from '../../api/valuations';
import { formatAmount, formatDate, parseDecimal } from '../../lib/format';
import { todayLocalIso } from '../../lib/dates';

// Record the market value of an investment account at a given date and
// manage past valuations. Value is a text input (French "1234,56" accepted)
// normalised through parseDecimal before it reaches the API.
export function ValuationDialog({
  account,
  onClose,
}: {
  account: Account | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['accounts', 'common']);
  const qc = useQueryClient();
  const today = todayLocalIso();
  const [date, setDate] = useState(today);
  const [valueText, setValueText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const accountId = account?.id;

  useEffect(() => {
    if (accountId != null) {
      setDate(todayLocalIso());
      setValueText('');
      setError(null);
    }
  }, [accountId]);

  useEffect(() => {
    if (!account) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [account, onClose]);

  const list = useQuery({
    queryKey: ['account-valuations', accountId],
    queryFn: () => listValuations(accountId!),
    enabled: accountId != null,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['account-valuations', accountId] });
    void qc.invalidateQueries({ queryKey: ['accounts'] });
    void qc.invalidateQueries({ queryKey: ['reports'] });
  };

  const save = useMutation({
    mutationFn: (body: { date: string; value: string }) => upsertValuation(accountId!, body),
    onSuccess: () => { setValueText(''); setError(null); refresh(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('valuation.errors.generic')),
  });
  const del = useMutation({
    mutationFn: (id: number) => deleteValuation(accountId!, id),
    onSuccess: () => { setError(null); refresh(); },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('valuation.errors.generic')),
  });

  if (!account) return null;

  const parsed = parseDecimal(valueText);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const canSave = parsed != null && dateValid && !save.isPending;
  const rows = list.data ?? [];

  const submit = () => {
    if (parsed == null) { setError(t('valuation.errors.invalidValue')); return; }
    if (!dateValid) { setError(t('valuation.errors.invalidDate')); return; }
    save.mutate({ date, value: parsed });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('valuation.title', { name: account.name })}
      onClick={onClose}
    >
      <div className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="display text-xl text-ink-50 mb-1 leading-snug">
          {t('valuation.title', { name: account.name })}
        </div>
        <div className="text-sm text-ink-400 mb-4 leading-relaxed">{t('valuation.subtitle')}</div>

        <div className="flex flex-wrap items-end gap-2 mb-3">
          <label className="text-xs text-ink-500">
            {t('valuation.dateLabel')}
            <input
              type="date"
              className="input-sm w-36 block mt-1"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="text-xs text-ink-500">
            {t('valuation.valueLabel', { currency: account.currency })}
            <input
              type="text"
              inputMode="decimal"
              className="input-sm w-32 block mt-1 text-right"
              placeholder="0.00"
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSave) submit(); }}
            />
          </label>
          <button type="button" className="btn-sm" disabled={!canSave} onClick={submit}>
            {t('valuation.save')}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200 mb-3">
            {error}
          </div>
        )}

        <div className="label mb-1">{t('valuation.history')}</div>
        {rows.length === 0 && !list.isLoading ? (
          <div className="text-[11px] text-ink-500 italic">{t('valuation.empty')}</div>
        ) : (
          <table className="w-full text-[11px] font-mono">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-ink-800/60">
                  <td className="py-1 text-ink-300">{formatDate(r.date)}</td>
                  <td className="py-1 text-right tabular-nums private">{formatAmount(r.value, account.currency)}</td>
                  <td className="py-1 text-right w-8">
                    <button
                      type="button"
                      className="text-ink-500 hover:text-clay-300 transition"
                      aria-label={t('valuation.deleteAria', { date: formatDate(r.date) })}
                      disabled={del.isPending}
                      onClick={() => del.mutate(r.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex justify-end mt-4">
          <button className="btn-ghost" onClick={onClose}>{t('close', { ns: 'common' })}</button>
        </div>
      </div>
    </div>
  );
}
