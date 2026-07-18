import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Account } from '../../api/types';
import {
  listPdfTemplates,
  deletePdfTemplate,
  type PdfTemplateRow,
} from '../../api/pdf-templates';
import { getAccountName } from '../../lib/accounts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingBlock } from '../../components/StateBlocks';

// Reads YYYY-MM-DD from an ISO timestamp and formats it as a short
// human-readable date. Kept inline to avoid pulling in the full formatDate
// helper's Intl overhead for a tiny label.
function shortIsoDate(ts: string): string {
  return ts.slice(0, 10);
}

export function PdfTemplatesPanel(): JSX.Element {
  const { t } = useTranslation(['imports', 'common']);
  const qc = useQueryClient();

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const templatesQ = useQuery({
    queryKey: ['pdf-templates'],
    queryFn: listPdfTemplates,
  });

  const [pending, setPending] = useState<PdfTemplateRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteMut = useMutation({
    mutationFn: (id: number) => deletePdfTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pdf-templates'] });
      setPending(null);
      setDeleteError(null);
    },
    onError: (err: Error) => setDeleteError(err.message),
  });

  const accounts = accountsQ.data?.accounts ?? [];
  const templates = templatesQ.data ?? [];

  if (templatesQ.isError) {
    return (
      <section>
        <div className="section-rule mb-4">{t('templates.sectionTitle')}</div>
        <ErrorState
          title={t('templates.errorTitle')}
          error={templatesQ.error}
          onRetry={() => void templatesQ.refetch()}
        />
      </section>
    );
  }

  if (templatesQ.isLoading) {
    return (
      <section>
        <div className="section-rule mb-4">{t('templates.sectionTitle')}</div>
        <LoadingBlock height="min-h-24" />
      </section>
    );
  }

  if (templates.length === 0) {
    return (
      <section>
        <div className="section-rule mb-4">{t('templates.sectionTitle')}</div>
        <div className="surface p-5 text-sm text-ink-400 display-italic">
          {t('templates.emptyState')}
        </div>
      </section>
    );
  }

  const legacyCount = templates.filter((tpl) => !tpl.hasPageAnchor).length;

  return (
    <section>
      <div className="section-rule mb-4">{t('templates.sectionTitle')}</div>
      <div className="surface p-5">
        <p className="text-sm text-ink-300 mb-3">
          {t('templates.description')}
        </p>
        {legacyCount > 0 && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/25 px-3 py-2 mb-3 text-sm text-clay-200">
            {t('templates.legacyWarning', { count: legacyCount })}{' '}
            {t('templates.legacyWarningSuffix')}
          </div>
        )}
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-3 py-2 label font-normal">{t('templates.table.label')}</th>
                <th className="px-3 py-2 label font-normal">{t('templates.table.account')}</th>
                <th className="px-3 py-2 label font-normal">{t('templates.table.pageFilter')}</th>
                <th className="px-3 py-2 label font-normal">{t('templates.table.origin')}</th>
                <th className="px-3 py-2 label font-normal whitespace-nowrap">{t('templates.table.updated')}</th>
                <th className="px-3 py-2 label font-normal text-right w-24">{t('templates.table.action')}</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => (
                <tr key={tpl.id} className="border-b border-ink-800/40 last:border-0 align-top">
                  <td className="px-3 py-2 text-ink-100 max-w-[18rem]">
                    <div className="truncate" title={tpl.label}>{tpl.label}</div>
                    {(tpl.pageAnchor || tpl.otherAnchors.length > 0) && (
                      <div className="mt-1 text-[10px] text-ink-500 font-mono leading-relaxed">
                        {tpl.pageAnchor && (
                          <div title={t('templates.matchTooltip')}>
                            <span className="text-ink-600">{t('templates.matchLabel')}</span>
                            <span className="text-ink-300">{tpl.pageAnchor}</span>
                          </div>
                        )}
                        {tpl.otherAnchors.length > 0 && (
                          <div title={t('templates.cutTooltip')}>
                            <span className="text-ink-600">{t('templates.cutLabel')}</span>
                            <span className="text-ink-300">{tpl.otherAnchors.join(' · ')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-300">
                    {tpl.accountId !== null ? getAccountName(accounts, tpl.accountId) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {tpl.hasPageAnchor ? (
                      <span className="text-xs text-sage-300" title={t('templates.byContentTitle')}>
                        {t('templates.byContent')}
                      </span>
                    ) : (
                      <span className="text-xs text-clay-300" title={t('templates.byPageNumberTitle')}>
                        {t('templates.byPageNumber')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-400 text-xs">
                    {tpl.source === 'interactive' ? t('templates.originInteractive') : t('templates.originHeuristic')}
                  </td>
                  <td className="px-3 py-2 text-ink-400 font-mono text-xs whitespace-nowrap">
                    {shortIsoDate(tpl.updatedAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="text-xs text-clay-300 hover:text-clay-200 border border-clay-800/60 hover:border-clay-700 rounded-md px-2 py-1 transition disabled:opacity-40"
                      disabled={deleteMut.isPending}
                      onClick={() => { setPending(tpl); setDeleteError(null); }}
                    >
                      {t('delete', { ns: 'common' })}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!pending}
        title={t('templates.deleteDialog.title')}
        description={
          pending ? (
            <>
              {t('templates.deleteDialog.descriptionPrefix')} <span className="display-italic">{pending.label}</span>{' '}
              {t('templates.deleteDialog.descriptionSuffix')}
            </>
          ) : null
        }
        confirmLabel={t('delete', { ns: 'common' })}
        destructive
        busy={deleteMut.isPending}
        error={deleteError}
        onConfirm={() => { if (pending) deleteMut.mutate(pending.id); }}
        onCancel={() => { setPending(null); setDeleteError(null); }}
      />
    </section>
  );
}
