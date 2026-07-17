import { useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { Account } from '../../api/types';
import { mergeAccount, type MergeResult } from '../../api/accounts';
import { formatAmount } from '../../lib/format';

interface MergeModalProps {
  open: boolean;
  source: Account;
  candidates: Account[];
  onCancel: () => void;
  onDone: (result: MergeResult) => void;
}

export function MergeModal({
  open, source, candidates, onCancel, onDone,
}: MergeModalProps) {
  const { t } = useTranslation(['accounts', 'common']);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTargetId(null);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const sameCurrency = useMemo(
    () => candidates.filter((a) => a.id !== source.id && a.currency === source.currency),
    [candidates, source.id, source.currency],
  );
  const target = sameCurrency.find((a) => a.id === targetId) ?? null;

  const submit = async () => {
    if (targetId == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await mergeAccount(source.id, targetId);
      onDone(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="display text-xl text-ink-50 mb-2 leading-snug">
          <Trans i18nKey="accounts:merge.title">
            Merge <span className="text-ink-200">{{ name: source.name } as unknown as string}</span> into another account
          </Trans>
        </div>
        <div className="text-sm text-ink-400 mb-4 leading-relaxed">
          {t('merge.subtitle')}
        </div>

        <label className="block text-xs text-ink-500 mb-1">{t('merge.destinationLabel')}</label>
        <select
          className="input w-full mb-4"
          value={targetId ?? ''}
          onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
          disabled={busy}
        >
          <option value="">{t('merge.selectPlaceholder')}</option>
          {sameCurrency.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {target && (
          <ul className="text-sm text-ink-400 space-y-1 mb-4 list-disc list-inside">
            <li>
              <Trans i18nKey="accounts:merge.warnings.moveTransactions">
                All transactions from the source will be moved to <b>{{ name: target.name } as unknown as string}</b>.
              </Trans>
            </li>
            <li>
              <Trans i18nKey="accounts:merge.warnings.addOpeningBalance">
                The opening balance ({{ amount: formatAmount(source.openingBalance, source.currency) } as unknown as string}) will be
                added to that of <b>{{ name: target.name } as unknown as string}</b>.
              </Trans>
            </li>
            <li>{t('merge.warnings.repoint')}</li>
            <li>{t('merge.warnings.breakTransfers')}</li>
            <li>
              <Trans i18nKey="accounts:merge.warnings.sourceDeleted">
                <b>{{ name: source.name } as unknown as string}</b> will be deleted. This action is <b>irreversible</b>.
              </Trans>
            </li>
          </ul>
        )}

        {error && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200 mb-4">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>{t('cancel', { ns: 'common' })}</button>
          <button
            className="btn-danger"
            onClick={submit}
            disabled={targetId == null || busy}
          >
            {busy ? '…' : t('merge.confirmButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
