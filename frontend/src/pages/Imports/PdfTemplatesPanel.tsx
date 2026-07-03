import { useState } from 'react';
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

// Reads YYYY-MM-DD from an ISO timestamp and formats it as a short
// human-readable date. Kept inline to avoid pulling in the full formatDate
// helper's Intl overhead for a tiny label.
function shortIsoDate(ts: string): string {
  return ts.slice(0, 10);
}

export function PdfTemplatesPanel(): JSX.Element {
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

  if (templatesQ.isLoading) {
    return (
      <section>
        <div className="section-rule mb-4">Templates PDF</div>
        <div className="surface p-5 h-20 animate-pulse rounded-lg bg-ink-900" />
      </section>
    );
  }

  if (templates.length === 0) {
    return (
      <section>
        <div className="section-rule mb-4">Templates PDF</div>
        <div className="surface p-5 text-sm text-ink-400 display-italic">
          Aucun template enregistré. Ils sont créés automatiquement à la fin de l'assistant
          après votre premier import PDF d'une nouvelle banque.
        </div>
      </section>
    );
  }

  const legacyCount = templates.filter((t) => !t.hasPageAnchor).length;

  return (
    <section>
      <div className="section-rule mb-4">Templates PDF</div>
      <div className="surface p-5">
        <p className="text-sm text-ink-300 mb-3">
          Un template décrit la mise en page d'une banque (zones du tableau, colonnes, pages du
          compte). Il est réutilisé automatiquement pour tous les prochains PDF de la même
          banque + compte.
        </p>
        {legacyCount > 0 && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/25 px-3 py-2 mb-3 text-sm text-clay-200">
            {legacyCount === 1
              ? '1 template utilise le filtrage par numéros de page absolus.'
              : `${legacyCount} templates utilisent le filtrage par numéros de page absolus.`}{' '}
            Si un futur relevé contient plus de pages que l'exemple d'origine, des transactions
            peuvent être ignorées. Supprimez le template puis réimportez le PDF pour passer au
            filtrage par contenu.
          </div>
        )}
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-3 py-2 label font-normal">Libellé</th>
                <th className="px-3 py-2 label font-normal">Compte</th>
                <th className="px-3 py-2 label font-normal">Filtre pages</th>
                <th className="px-3 py-2 label font-normal">Origine</th>
                <th className="px-3 py-2 label font-normal whitespace-nowrap">Mis à jour</th>
                <th className="px-3 py-2 label font-normal text-right w-24">Action</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-ink-800/40 last:border-0">
                  <td className="px-3 py-2 text-ink-100 truncate max-w-[18rem]" title={t.label}>
                    {t.label}
                  </td>
                  <td className="px-3 py-2 text-ink-300">
                    {t.accountId !== null ? getAccountName(accounts, t.accountId) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {t.hasPageAnchor ? (
                      <span className="text-xs text-sage-300" title="Filtrage basé sur le contenu (marqueur automatique)">
                        Par contenu
                      </span>
                    ) : (
                      <span className="text-xs text-clay-300" title="Filtrage par numéros de page absolus — recréez le template pour passer au filtrage par contenu">
                        Par numéro (ancien)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-400 text-xs">
                    {t.source === 'interactive' ? 'Assistant' : 'Heuristique'}
                  </td>
                  <td className="px-3 py-2 text-ink-400 font-mono text-xs whitespace-nowrap">
                    {shortIsoDate(t.updatedAt)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="text-xs text-clay-300 hover:text-clay-200 border border-clay-800/60 hover:border-clay-700 rounded-md px-2 py-1 transition disabled:opacity-40"
                      disabled={deleteMut.isPending}
                      onClick={() => { setPending(t); setDeleteError(null); }}
                    >
                      Supprimer
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
        title="Supprimer ce template ?"
        description={
          pending ? (
            <>
              Le template <span className="display-italic">{pending.label}</span> sera supprimé.
              Le prochain import PDF avec la même empreinte de banque relancera l'assistant.
              Les transactions déjà importées ne sont pas affectées.
            </>
          ) : null
        }
        confirmLabel="Supprimer"
        destructive
        busy={deleteMut.isPending}
        error={deleteError}
        onConfirm={() => { if (pending) deleteMut.mutate(pending.id); }}
        onCancel={() => { setPending(null); setDeleteError(null); }}
      />
    </section>
  );
}
