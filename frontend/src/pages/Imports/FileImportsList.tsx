import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, FileImport } from '../../api/types';
import { formatDateTime } from '../../lib/format';

export function FileImportsList({
  imports, accounts, onRequestDelete,
}: {
  imports: FileImport[];
  accounts: Account[];
  onRequestDelete: (fileImport: FileImport) => void;
}): JSX.Element {
  const qc = useQueryClient();

  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `#${id}`;

  // Reconciliation: state + mutation to set the closing balance on an import.
  const [reconcilingId, setReconcilingId] = useState<number | null>(null);
  const [reconcileForm, setReconcileForm] = useState<{ statedBalance: string; statedBalanceDate: string }>(
    { statedBalance: '', statedBalanceDate: '' },
  );
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const reconcileMut = useMutation({
    mutationFn: (vars: { id: number; statedBalance: string | null; statedBalanceDate: string | null }) =>
      api<{ fileImport: FileImport }>(`/api/imports/${vars.id}`, {
        method: 'PATCH',
        json: {
          statedBalance: vars.statedBalance,
          statedBalanceDate: vars.statedBalanceDate,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['imports'] });
      setReconcilingId(null);
      setReconcileError(null);
    },
    onError: (err: ApiError) => setReconcileError(err.message),
  });

  function startReconcile(i: FileImport) {
    setReconcileError(null);
    setReconcilingId(i.id);
    setReconcileForm({
      statedBalance: i.statedBalance ?? '',
      statedBalanceDate: i.statedBalanceDate ?? '',
    });
  }
  function cancelReconcile() {
    setReconcilingId(null);
    setReconcileError(null);
  }
  function saveReconcile(id: number) {
    const sb = reconcileForm.statedBalance.trim();
    const sd = reconcileForm.statedBalanceDate.trim();
    if (!sb || !sd) {
      setReconcileError('Renseignez le solde et la date.');
      return;
    }
    // Accept comma as decimal sep (French keyboards) and " " as thousand sep.
    const normalized = sb.replace(/\s/g, '').replace(',', '.');
    reconcileMut.mutate({ id, statedBalance: normalized, statedBalanceDate: sd });
  }
  function clearReconcile(id: number) {
    reconcileMut.mutate({ id, statedBalance: null, statedBalanceDate: null });
  }

  return (
    <section>
      <div className="section-rule mb-4">Historique</div>
      <div className="surface overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr className="border-b border-ink-800/70">
                <th className="px-4 py-3 label font-normal">Fichier</th>
                <th className="px-4 py-3 label font-normal">Compte</th>
                <th className="px-4 py-3 label font-normal">Format</th>
                <th className="px-4 py-3 label font-normal text-right">Lues</th>
                <th className="px-4 py-3 label font-normal text-right">Insérées</th>
                <th className="px-4 py-3 label font-normal text-right">Dédup.</th>
                <th className="px-4 py-3 label font-normal">Quand</th>
                <th className="px-4 py-3 label font-normal text-right">Solde déclaré</th>
                <th className="px-4 py-3 label font-normal text-right">Δ</th>
                <th className="px-4 py-3 label font-normal w-8"></th>
              </tr>
            </thead>
            <tbody>
              {imports.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-ink-500 display-italic">
                    Aucun import pour l'instant.
                  </td>
                </tr>
              ) : (
                imports.flatMap((i) => {
                  const editing = reconcilingId === i.id;
                  const hasStated = i.statedBalance !== null && i.statedBalanceDate !== null;
                  const deltaNum = i.delta !== null ? Number(i.delta) : null;
                  const deltaTone =
                    deltaNum === null
                      ? 'text-ink-500'
                      : Math.abs(deltaNum) < 0.005
                      ? 'text-sage-300'
                      : Math.abs(deltaNum) < 1
                      ? 'text-amber-300'
                      : 'text-clay-300';
                  const rows = [
                    <tr key={i.id} className="border-b border-ink-800/40 last:border-0">
                      <td className="px-4 py-2.5 text-ink-100 font-mono text-xs">{i.filename}</td>
                      <td className="px-4 py-2.5 text-ink-300">{accountName(i.accountId)}</td>
                      <td className="px-4 py-2.5"><span className="badge">{i.format}</span></td>
                      <td className="px-4 py-2.5 text-right text-ink-300 font-mono">{i.totalLines}</td>
                      <td className="px-4 py-2.5 text-right text-sage-300 font-mono">{i.insertedCount}</td>
                      <td className="px-4 py-2.5 text-right text-ink-400 font-mono">{i.dedupSkipped}</td>
                      <td className="px-4 py-2.5 text-ink-400 text-xs whitespace-nowrap">{formatDateTime(i.importedAt)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {hasStated ? (
                          <button
                            className="text-ink-200 hover:text-ink-50 transition underline-offset-2 hover:underline"
                            onClick={() => startReconcile(i)}
                            title={`au ${i.statedBalanceDate}`}
                          >
                            {Number(i.statedBalance).toFixed(2)}
                          </button>
                        ) : (
                          <button
                            className="text-ink-400 hover:text-sage-300 transition text-xs"
                            onClick={() => startReconcile(i)}
                          >
                            Renseigner
                          </button>
                        )}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono ${deltaTone}`}>
                        {deltaNum === null
                          ? '—'
                          : `${deltaNum >= 0 ? '+' : ''}${deltaNum.toFixed(2)}`}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <button
                          className="text-ink-500 hover:text-clay-300 transition px-1"
                          onClick={() => onRequestDelete(i)}
                          title="Supprimer cet import et toutes ses transactions"
                          aria-label="Supprimer l'import"
                        >🗑</button>
                      </td>
                    </tr>,
                  ];
                  if (editing) {
                    rows.push(
                      <tr key={`${i.id}-edit`} className="border-b border-ink-800/40 bg-ink-850/50">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <div>
                              <label className="block text-xs text-ink-400 mb-1">Date du solde</label>
                              <input
                                type="date"
                                className="rounded-lg border border-ink-700 bg-ink-900 text-ink-100 px-2 py-1.5 text-sm focus:border-sage-300 focus:outline-none"
                                value={reconcileForm.statedBalanceDate}
                                onChange={(e) => setReconcileForm((f) => ({ ...f, statedBalanceDate: e.target.value }))}
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-ink-400 mb-1">Solde déclaré (€)</label>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="ex: 1234,56"
                                className="rounded-lg border border-ink-700 bg-ink-900 text-ink-100 px-2 py-1.5 text-sm font-mono w-36 focus:border-sage-300 focus:outline-none"
                                value={reconcileForm.statedBalance}
                                onChange={(e) => setReconcileForm((f) => ({ ...f, statedBalance: e.target.value }))}
                              />
                            </div>
                            <button
                              className="px-3 py-1.5 rounded-lg bg-sage-300 text-ink-950 font-medium hover:bg-sage-200 transition disabled:opacity-40"
                              disabled={reconcileMut.isPending}
                              onClick={() => saveReconcile(i.id)}
                            >{reconcileMut.isPending ? '…' : 'Enregistrer'}</button>
                            <button
                              className="px-3 py-1.5 rounded-lg border border-ink-700 text-ink-200 hover:bg-ink-850 transition"
                              onClick={cancelReconcile}
                            >Annuler</button>
                            {hasStated && (
                              <button
                                className="ml-auto px-3 py-1.5 rounded-lg border border-clay-800/60 text-clay-200 hover:bg-clay-900/30 transition text-sm"
                                disabled={reconcileMut.isPending}
                                onClick={() => clearReconcile(i.id)}
                                title="Effacer le solde déclaré pour cet import"
                              >Effacer</button>
                            )}
                          </div>
                          {reconcileError && (
                            <p className="mt-2 text-xs text-clay-300">{reconcileError}</p>
                          )}
                          {hasStated && deltaNum !== null && (
                            <p className="mt-2 text-xs text-ink-400">
                              Calculé&nbsp;: <span className="font-mono text-ink-200">{Number(i.computedBalance).toFixed(2)}</span>
                              {'  ·  '}Écart&nbsp;: <span className={`font-mono ${deltaTone}`}>
                                {deltaNum >= 0 ? '+' : ''}{deltaNum.toFixed(2)}
                              </span>
                            </p>
                          )}
                        </td>
                      </tr>,
                    );
                  }
                  return rows;
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
