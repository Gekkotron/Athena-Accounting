import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload, ApiError } from '../../api/client';
import type { Account, FileImport } from '../../api/types';
import { formatDateTime } from '../../lib/format';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { submitPdf, type PdfImportNeedsTemplate, type PdfImportImported } from '../../api/pdf-templates';
import { BackupPanel } from './BackupPanel';
import { PdfTemplateWizard } from './PdfTemplateWizard';
import { DuplicatesPanel } from './DuplicatesPanel';

export function Imports() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    filename: string;
    inserted: number;
    skipped: number;
    total: number;
  } | null>(null);

  // PDF-specific state
  const [needsTpl, setNeedsTpl] = useState<PdfImportNeedsTemplate | null>(null);
  const [lastImported, setLastImported] = useState<PdfImportImported | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfPending, setPdfPending] = useState(false);

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const importsQ = useQuery({
    queryKey: ['imports'],
    queryFn: () => api<{ imports: FileImport[] }>('/api/imports'),
  });

  const accounts = accountsQ.data?.accounts ?? [];

  const upload = useMutation({
    mutationFn: ({ file, accountId }: { file: File; accountId: number | '' }) =>
      apiUpload<{
        filename: string;
        insertedCount: number;
        dedupSkipped: number;
        totalLines: number;
      }>('/api/imports', file, {
        // Empty string -> let the server auto-resolve via filename patterns.
        query: accountId ? { accountId } : undefined,
      }),
    onSuccess: (data, vars) => {
      setLastResult({
        filename: vars.file.name,
        inserted: data.insertedCount,
        skipped: data.dedupSkipped,
        total: data.totalLines,
      });
      qc.invalidateQueries({ queryKey: ['imports'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (err: ApiError) => {
      setError(err.message);
      setLastResult(null);
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.pdf')) {
      if (accountId === '') {
        setError('Veuillez sélectionner un compte pour importer un PDF.');
        return;
      }
      setError(null);
      setPdfError(null);
      setLastImported(null);
      setNeedsTpl(null);
      setPdfPending(true);
      try {
        const r = await submitPdf(file, accountId);
        if (r.kind === 'imported') {
          setLastImported(r);
          qc.invalidateQueries({ queryKey: ['imports'] });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
          qc.invalidateQueries({ queryKey: ['reports'] });
          qc.invalidateQueries({ queryKey: ['tri-groups'] });
          qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
          setFile(null);
          if (fileRef.current) fileRef.current.value = '';
        } else {
          setNeedsTpl(r);
        }
      } catch (err) {
        setPdfError(err instanceof Error ? err.message : 'Erreur lors de l\'import PDF.');
      } finally {
        setPdfPending(false);
      }
      return;
    }

    setError(null);
    upload.mutate({ file, accountId });
  };

  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `#${id}`;

  // Cascading delete: removes the import row and all transactions that came
  // from it. Used to undo a bad import or replay an old PDF with the new label
  // logic without leaving duplicates behind.
  const [pendingDeleteImport, setPendingDeleteImport] = useState<FileImport | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteImportMut = useMutation({
    mutationFn: (id: number) =>
      api<{ deleted: { transactions: number; fileImport: number } }>(
        `/api/imports/${id}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['imports'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setPendingDeleteImport(null);
      setDeleteError(null);
    },
    onError: (err: ApiError) => setDeleteError(err.message),
  });

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
    <div className="flex flex-col gap-8">
      <div className="page-header">
        <div>
          <h1 className="page-title">Imports</h1>
          <p className="page-subtitle">
            OFX (Latin-1/UTF-8), CSV FR (séparateur « ; », décimale virgule, dates JJ/MM/AAAA) ou PDF relevé bancaire.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="surface p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <label className="label">Fichier (.ofx · .qfx · .csv · .pdf)</label>
            <input
              ref={fileRef}
              type="file"
              accept=".ofx,.qfx,.csv,.pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
                setLastResult(null);
                setPdfError(null);
                setLastImported(null);
              }}
              disabled={upload.isPending || pdfPending}
              className="block text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sage-300 file:text-ink-950 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-sage-200 file:transition file:cursor-pointer"
            />
          </div>

          <div className="flex flex-col gap-1.5 w-full md:w-60">
            <label className="label">Compte</label>
            <select
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Auto (via nom du fichier)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <button className="btn-primary" disabled={!file || upload.isPending || pdfPending}>
            {(upload.isPending || pdfPending) ? 'Import…' : 'Importer'}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
          {error}
        </div>
      )}

      <PdfTemplateWizard
        needsTpl={needsTpl}
        lastImported={lastImported}
        pdfError={pdfError}
        accountId={accountId}
        onFinalize={(r) => {
          setNeedsTpl(null);
          setLastImported(r);
          qc.invalidateQueries({ queryKey: ['imports'] });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
          qc.invalidateQueries({ queryKey: ['reports'] });
          qc.invalidateQueries({ queryKey: ['tri-groups'] });
        }}
        onCancel={() => setNeedsTpl(null)}
      />

      {lastResult && (
        <div className="surface p-5">
          <div className="label mb-2">Dernier import</div>
          <div className="font-mono text-sm text-ink-100 truncate">{lastResult.filename}</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="display text-2xl text-ink-100">{lastResult.total}</span>
              <span className="text-ink-500 ml-2">lue{lastResult.total > 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-sage-300">{lastResult.inserted}</span>
              <span className="text-ink-500 ml-2">insérée{lastResult.inserted > 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-ink-400">{lastResult.skipped}</span>
              <span className="text-ink-500 ml-2">dédupliquée{lastResult.skipped > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      )}

      <BackupPanel />

      <ConfirmDialog
        open={!!pendingDeleteImport}
        title="Supprimer cet import ?"
        description={
          pendingDeleteImport ? (
            <>
              <span className="display-italic">{pendingDeleteImport.filename}</span> et les{' '}
              <span className="display-italic">{pendingDeleteImport.insertedCount}</span>{' '}
              transaction(s) qui en proviennent seront définitivement supprimées.
              L'opération est transactionnelle&nbsp;: tout ou rien.
            </>
          ) : null
        }
        confirmLabel="Supprimer"
        destructive
        busy={deleteImportMut.isPending}
        error={deleteError}
        onConfirm={() => {
          if (!pendingDeleteImport) return;
          deleteImportMut.mutate(pendingDeleteImport.id);
        }}
        onCancel={() => { setPendingDeleteImport(null); setDeleteError(null); }}
      />

      <DuplicatesPanel />

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
                {(importsQ.data?.imports ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-ink-500 display-italic">
                      Aucun import pour l'instant.
                    </td>
                  </tr>
                ) : (
                  (importsQ.data?.imports ?? []).flatMap((i) => {
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
                            onClick={() => { setDeleteError(null); setPendingDeleteImport(i); }}
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
    </div>
  );
}
