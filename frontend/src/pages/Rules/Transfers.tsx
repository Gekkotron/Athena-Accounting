import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';
import type { Account, TransferRule } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/StateBlocks';

export function Transfers() {
  const { t } = useTranslation('rules');
  const qc = useQueryClient();

  const rulesQ = useQuery({
    queryKey: ['transfer-rules'],
    queryFn: () => api<{ transferRules: TransferRule[] }>('/api/transfer-rules'),
  });
  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });

  const [keyword, setKeyword] = useState('');
  const [counterpartAccountId, setCounterpartAccountId] = useState<number | ''>('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TransferRule | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: { keyword: string; counterpartAccountId: number | null }) =>
      api('/api/transfer-rules', {
        method: 'POST',
        // `direction` is required by the API contract but not read by the
        // import-time detector (it matches both legs by amount sign), so the
        // form doesn't surface it.
        json: { ...input, direction: 'outgoing', enabled: true },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfer-rules'] });
      setKeyword('');
      setCounterpartAccountId('');
      setCreateError(null);
    },
    onError: (err: ApiError) => setCreateError(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<TransferRule> }) =>
      api(`/api/transfer-rules/${id}`, { method: 'PUT', json: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfer-rules'] }),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/transfer-rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transfer-rules'] });
      setConfirmDelete(null);
      setDeleteError(null);
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a] as const)),
    [accounts],
  );
  const rules = rulesQ.data?.transferRules ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const kw = keyword.trim();
    if (!kw || create.isPending) return;
    create.mutate({
      keyword: kw,
      counterpartAccountId: counterpartAccountId === '' ? null : counterpartAccountId,
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('transfers.title')}</h1>
          <p className="page-subtitle max-w-2xl">{t('transfers.subtitle')}</p>
        </div>
      </div>

      <form onSubmit={submit} className="surface p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label mb-1.5 block" htmlFor="transfer-keyword">
            {t('transfers.form.keywordLabel')}
          </label>
          <input
            id="transfer-keyword"
            className="input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t('transfers.form.keywordPlaceholder')}
            required
          />
          <div className="text-[11px] text-ink-500 mt-1.5">{t('transfers.form.keywordHelp')}</div>
        </div>
        <div>
          <label className="label mb-1.5 block" htmlFor="transfer-counterpart">
            {t('transfers.form.counterpartLabel')}
          </label>
          <select
            id="transfer-counterpart"
            className="input"
            value={counterpartAccountId}
            onChange={(e) => setCounterpartAccountId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">{t('transfers.form.anyAccount')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-primary" disabled={create.isPending}>
            {create.isPending ? t('transfers.form.submitPending') : t('transfers.form.submit')}
          </button>
        </div>
        {createError && (
          <div className="sm:col-span-2 lg:col-span-4 text-sm text-clay-300">{createError}</div>
        )}
      </form>

      {rulesQ.isError ? (
        <ErrorState
          title={t('transfers.listErrorTitle')}
          error={rulesQ.error}
          onRetry={() => void rulesQ.refetch()}
        />
      ) : rulesQ.isLoading ? (
        <LoadingBlock height="min-h-48" />
      ) : rules.length === 0 ? (
        <EmptyState title={t('transfers.emptyTitle')} hint={t('transfers.emptyDescription')} />
      ) : (
        <div className="surface divide-y divide-ink-800">
          {rules.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className={`font-mono text-sm ${r.enabled ? 'text-ink-100' : 'text-ink-500 line-through'}`}>
                {r.keyword}
              </span>
              <span className="text-xs text-ink-400">
                {r.counterpartAccountId
                  ? t('transfers.row.counterpart', {
                      account: accountById.get(r.counterpartAccountId)?.name ?? `#${r.counterpartAccountId}`,
                    })
                  : t('transfers.row.anyAccount')}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  className="btn-secondary text-xs"
                  onClick={() => update.mutate({ id: r.id, patch: { enabled: !r.enabled } })}
                  disabled={update.isPending}
                >
                  {r.enabled ? t('transfers.row.disable') : t('transfers.row.enable')}
                </button>
                <button
                  className="btn-secondary text-xs text-clay-300"
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmDelete(r);
                  }}
                >
                  {t('transfers.row.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete ? t('transfers.deleteDialog.title', { keyword: confirmDelete.keyword }) : ''}
        description={t('transfers.deleteDialog.description')}
        confirmLabel={t('transfers.deleteDialog.confirmLabel')}
        destructive
        busy={del.isPending}
        error={deleteError}
        onConfirm={() => confirmDelete && del.mutate(confirmDelete.id)}
        onCancel={() => {
          setConfirmDelete(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
