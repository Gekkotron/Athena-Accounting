import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account, AccountFilenamePattern } from '../../api/types';

export function PatternsSection({
  patterns,
  accounts,
}: {
  patterns: AccountFilenamePattern[];
  accounts: Account[];
}) {
  const { t } = useTranslation('accounts');
  const qc = useQueryClient();
  const [pattern, setPattern] = useState('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [priority, setPriority] = useState(0);

  const create = useMutation({
    mutationFn: (input: { pattern: string; accountId: number; priority: number }) =>
      api('/api/account-filename-patterns', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patterns'] });
      setPattern('');
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/account-filename-patterns/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patterns'] }),
  });

  const acctName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `#${id}`;

  return (
    <section>
      <div className="section-rule mb-2">{t('patterns.sectionTitle')}</div>
      <div className="surface p-4 mb-3 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="label mb-1.5 block">{t('patterns.patternLabel')}</label>
          <input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </div>
        <div className="w-full sm:w-44">
          <label className="label mb-1.5 block">{t('patterns.accountLabel')}</label>
          <select
            className="input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="w-24">
          <label className="label mb-1.5 block">{t('patterns.priorityLabel')}</label>
          <input
            inputMode="numeric"
            className="input font-mono"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>
        <button
          className="btn-secondary"
          onClick={() => pattern && accountId && create.mutate({ pattern, accountId, priority })}
          disabled={!pattern || !accountId}
        >
          {t('patterns.addButton')}
        </button>
      </div>
      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 label font-normal">{t('patterns.patternLabel')}</th>
                <th className="px-4 py-3 label font-normal">{t('patterns.accountLabel')}</th>
                <th className="px-4 py-3 label font-normal">{t('patterns.priorityLabel')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {patterns.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-ink-500 display-italic">
                    {t('patterns.emptyState')}
                  </td>
                </tr>
              ) : (
                patterns.map((p) => (
                  <tr key={p.id} className="border-b border-ink-800/40 last:border-0">
                    <td className="px-4 py-2.5 text-ink-100 font-mono text-xs">{p.pattern}</td>
                    <td className="px-4 py-2.5 text-ink-300">{acctName(p.accountId)}</td>
                    <td className="px-4 py-2.5 text-ink-400 font-mono">{p.priority}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button className="text-[11px] text-ink-500 hover:text-clay-300" onClick={() => del.mutate(p.id)}>
                        {t('patterns.deleteButton')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
