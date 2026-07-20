import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { AccountFilenamePattern } from '../../api/types';

export function AccountPatternsPanel({ accountId }: { accountId: number }) {
  const { t } = useTranslation('accounts');
  const qc = useQueryClient();
  const [pattern, setPattern] = useState('');
  const [priority, setPriority] = useState('0');

  const patternsQ = useQuery({
    queryKey: ['patterns'],
    queryFn: () => api<{ patterns: AccountFilenamePattern[] }>('/api/account-filename-patterns'),
  });

  const rows = (patternsQ.data?.patterns ?? []).filter((p) => p.accountId === accountId);

  const create = useMutation({
    mutationFn: (input: { pattern: string; accountId: number; priority: number }) =>
      api('/api/account-filename-patterns', { method: 'POST', json: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patterns'] });
      setPattern('');
      setPriority('0');
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/api/account-filename-patterns/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patterns'] }),
  });

  const submit = () => {
    const trimmed = pattern.trim();
    if (!trimmed) return;
    const parsedPriority = Number.isFinite(Number(priority)) ? Math.floor(Number(priority)) : 0;
    create.mutate({ pattern: trimmed, accountId, priority: parsedPriority });
  };

  return (
    <div className="border-t border-ink-800/60 mt-4 pt-4">
      <div className="label mb-1">{t('patterns.sectionTitle')}</div>
      <div className="text-[11px] text-ink-500 mb-3">{t('patterns.sectionHint')}</div>

      {rows.length > 0 && (
        <ul className="flex flex-col gap-1 mb-3">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-md bg-ink-900/40 px-2.5 py-1.5"
            >
              <span className="font-mono text-xs text-ink-100 truncate flex-1">{p.pattern}</span>
              <span
                className="text-[10px] text-ink-500 font-mono"
                title={t('patterns.priorityLabel')}
              >
                {t('patterns.priorityInline', { value: p.priority })}
              </span>
              <button
                className="text-[11px] text-ink-500 hover:text-clay-300 transition"
                onClick={() => del.mutate(p.id)}
              >
                {t('patterns.deleteButton')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <label className="label mb-1 block">{t('patterns.patternLabel')}</label>
          <input
            className="input"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={t('patterns.patternPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>
        <div className="w-16">
          <label className="label mb-1 block">{t('patterns.priorityLabel')}</label>
          <input
            inputMode="numeric"
            className="input font-mono"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </div>
        <button
          className="btn-secondary"
          onClick={submit}
          disabled={!pattern.trim() || create.isPending}
        >
          {t('patterns.addButton')}
        </button>
      </div>
    </div>
  );
}
