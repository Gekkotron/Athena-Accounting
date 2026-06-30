import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload, ApiError } from '../api/client';
import type { Account, FileImport } from '../api/types';
import { formatDateTime } from '../lib/format';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { submitPdf, type PdfImportNeedsTemplate, type PdfImportImported } from '../api/pdf-templates';
import { PdfTemplateBuilder } from '../components/PdfTemplateBuilder/index';

interface BackupResult {
  imported: {
    accounts: number;
    categories: number;
    accountFilenamePatterns: number;
    rules: number;
    transferRules: number;
    transactions: number;
    fileImports?: number;
  };
}

export function Imports() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const backupFileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    filename: string;
    inserted: number;
    skipped: number;
    total: number;
  } | null>(null);

  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [exporting, setExporting] = useState(false);
  // Holds the parsed JSON between the user picking a file and confirming
  // the destructive import in the dialog.
  const [pendingImport, setPendingImport] = useState<unknown | null>(null);

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

  // Streams the backup endpoint to a downloadable file. We can't use a plain
  // <a href> because the endpoint requires the session cookie and we want
  // proper "save as" behaviour with a meaningful filename.
  const exportBackup = async () => {
    setBackupError(null);
    setBackupResult(null);
    setExporting(true);
    try {
      const res = await fetch('/api/backup/export', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const today = new Date().toISOString().slice(0, 10);
      a.download = `athena-backup-${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'export failed');
    } finally {
      setExporting(false);
    }
  };

  // Soft-dup detection: groups of transactions sharing (account, date, amount)
  // but with different dedup_keys. Surfaces after each import so the user can
  // resolve labels-that-look-the-same-but-aren't (the OFX/PDF gap).
  type DupGroup = {
    accountId: number;
    date: string;
    amount: string;
    transactions: Array<{ id: number; raw_label: string; normalized_label: string; source_file_id: number | null; category_id: number | null }>;
  };
  const dupsQ = useQuery({
    queryKey: ['transaction-duplicates'],
    queryFn: () => api<{ groups: DupGroup[] }>('/api/transactions/duplicates'),
    refetchOnWindowFocus: false,
  });

  // Mark every row in a doublons group as "not a duplicate". The group then
  // disappears from the panel because BOOL_OR(NOT not_duplicate) goes false.
  // If a NEW row with the same (account, date, amount) shows up later, the
  // group re-appears so the user can re-evaluate.
  const markNotDuplicateMut = useMutation({
    mutationFn: (ids: number[]) =>
      api<{ updated: number }>('/api/transactions/mark-not-duplicate', {
        method: 'POST',
        json: { ids },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
    },
  });

  // Delete a single transaction directly from the doublons panel. Confirms inline
  // before firing to avoid an accidental click on the trash icon.
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<number | null>(null);
  const [dupDeleteError, setDupDeleteError] = useState<string | null>(null);
  const deleteTxMut = useMutation({
    mutationFn: (id: number) =>
      api<{ ok: true }>(`/api/transactions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['accounts'] });
      qc.invalidateQueries({ queryKey: ['reports'] });
      qc.invalidateQueries({ queryKey: ['tri-groups'] });
      setConfirmDeleteTxId(null);
      setDupDeleteError(null);
    },
    onError: (err: ApiError) => setDupDeleteError(err.message),
  });

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

  const importBackupMut = useMutation({
    mutationFn: (dump: unknown) =>
      api<BackupResult>('/api/backup/import', { method: 'POST', json: dump }),
    onSuccess: (data) => {
      setBackupResult(data);
      qc.invalidateQueries();
      if (backupFileRef.current) backupFileRef.current.value = '';
    },
    onError: (err: ApiError) => setBackupError(err.message),
  });

  const onBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBackupError(null);
    setBackupResult(null);
    let json: unknown;
    try {
      const text = await f.text();
      json = JSON.parse(text);
    } catch {
      setBackupError('Fichier JSON invalide.');
      if (backupFileRef.current) backupFileRef.current.value = '';
      return;
    }
    setPendingImport(json);
  };

  const cancelImport = () => {
    setPendingImport(null);
    if (backupFileRef.current) backupFileRef.current.value = '';
  };

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

      {pdfError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
          {pdfError}
        </div>
      )}

      {lastImported && (
        <div className="surface p-5">
          <div className="label mb-2">Dernier import PDF</div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="display text-2xl text-ink-100">{lastImported.result.totalLines}</span>
              <span className="text-ink-500 ml-2">lue{lastImported.result.totalLines !== 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-sage-300">{lastImported.result.insertedCount}</span>
              <span className="text-ink-500 ml-2">insérée{lastImported.result.insertedCount !== 1 ? 's' : ''}</span>
            </div>
            <div>
              <span className="display text-2xl text-ink-400">{lastImported.result.dedupSkipped}</span>
              <span className="text-ink-500 ml-2">dédupliquée{lastImported.result.dedupSkipped !== 1 ? 's' : ''}</span>
            </div>
          </div>
          {lastImported.skippedRows.length > 0 && (
            <details className="mt-3 text-sm text-ink-400">
              <summary className="cursor-pointer">{lastImported.skippedRows.length} ligne(s) ignorée(s)</summary>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {lastImported.skippedRows.map((s, i) => (
                  <li key={i}><code>{s.rowText}</code> — {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {needsTpl && (
        <PdfTemplateBuilder
          needsTemplate={needsTpl}
          onClose={() => setNeedsTpl(null)}
          onImported={(r) => {
            setNeedsTpl(null);
            setLastImported(r);
            qc.invalidateQueries({ queryKey: ['imports'] });
            qc.invalidateQueries({ queryKey: ['transactions'] });
            qc.invalidateQueries({ queryKey: ['accounts'] });
            qc.invalidateQueries({ queryKey: ['reports'] });
            qc.invalidateQueries({ queryKey: ['tri-groups'] });
          }}
        />
      )}

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

      {/* Backup section — export everything as JSON, or restore from one. */}
      <section>
        <div className="section-rule mb-4">Sauvegarde complète</div>
        <div className="surface p-5 md:p-6 flex flex-col gap-4">
          <p className="text-sm text-ink-400 max-w-2xl">
            <span className="display-italic">Export</span> : télécharge l'intégralité de vos comptes,
            catégories, règles et transactions au format JSON (avec dedup_key préservé, donc
            la réimportation est idempotente).{' '}
            <span className="display-italic">Import</span> : remplace TOUTES les données par
            celles du fichier choisi — pratique pour basculer entre instances ou tester un
            roundtrip.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-primary"
              onClick={exportBackup}
              disabled={exporting}
            >
              {exporting ? 'Export…' : 'Exporter (JSON)'}
            </button>

            <label className="btn-secondary cursor-pointer">
              {importBackupMut.isPending ? 'Import en cours…' : 'Importer une sauvegarde…'}
              <input
                ref={backupFileRef}
                type="file"
                accept=".json,application/json"
                onChange={onBackupFile}
                disabled={importBackupMut.isPending}
                className="hidden"
              />
            </label>
          </div>

          {backupError && (
            <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
              {backupError}
            </div>
          )}

          {backupResult && (
            <div className="rounded-lg border border-sage-800/50 bg-sage-900/15 px-4 py-3 text-sm">
              <div className="text-sage-200 font-medium mb-1">Sauvegarde restaurée</div>
              <div className="text-ink-300 font-mono text-xs leading-relaxed">
                {backupResult.imported.accounts} compte(s) · {backupResult.imported.categories} catégorie(s) ·{' '}
                {backupResult.imported.rules} règle(s) · {backupResult.imported.transferRules} transfer-rule(s) ·{' '}
                {backupResult.imported.accountFilenamePatterns} motif(s) ·{' '}
                {backupResult.imported.transactions} transaction(s)
                {backupResult.imported.fileImports !== undefined && (
                  <> · {backupResult.imported.fileImports} import(s)</>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

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

      <ConfirmDialog
        open={!!pendingImport}
        title="Importer cette sauvegarde ?"
        description={
          <>
            <span className="display-italic">Toutes</span> les données actuelles (comptes,
            catégories, règles, transactions) seront <span className="display-italic">effacées</span>
            {' '}puis remplacées par celles du fichier. L'opération est transactionnelle :
            si elle échoue à mi-chemin, rien n'est appliqué.
          </>
        }
        confirmLabel="Effacer et restaurer"
        destructive
        busy={importBackupMut.isPending}
        error={backupError}
        onConfirm={() => {
          if (!pendingImport) return;
          importBackupMut.mutate(pendingImport, {
            onSuccess: () => setPendingImport(null),
          });
        }}
        onCancel={cancelImport}
      />

      {(dupsQ.data?.groups ?? []).length > 0 && (
        <section>
          <div className="section-rule mb-4">Possibles doublons</div>
          <div className="surface p-5">
            <p className="text-sm text-ink-300 mb-3">
              Ces transactions partagent compte + date + montant mais ont des libellés différents.
              Probable doublon entre un import OFX et un import PDF de la même transaction. Vérifiez et
              supprimez la version en trop via la page <span className="display-italic">Transactions</span>.
            </p>
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr className="border-b border-ink-800/70">
                    <th className="px-4 py-3 label font-normal">Compte</th>
                    <th className="px-4 py-3 label font-normal">Date</th>
                    <th className="px-4 py-3 label font-normal text-right">Montant</th>
                    <th className="px-4 py-3 label font-normal">Libellés en conflit</th>
                    <th className="px-4 py-3 label font-normal text-right w-44">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(dupsQ.data?.groups ?? []).map((g, gi) => (
                    <tr key={`${g.accountId}-${g.date}-${g.amount}-${gi}`} className="border-b border-ink-800/40 last:border-0 align-top">
                      <td className="px-4 py-2.5 text-ink-300">{accountName(g.accountId)}</td>
                      <td className="px-4 py-2.5 text-ink-300 font-mono text-xs whitespace-nowrap">{g.date}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-ink-100">
                        {Number(g.amount).toFixed(2).replace('.', ',')} €
                      </td>
                      <td className="px-4 py-2.5">
                        <ul className="space-y-1">
                          {g.transactions.map((t) => {
                            const confirming = confirmDeleteTxId === t.id;
                            return (
                              <li key={t.id} className="flex items-baseline gap-2">
                                <code className="text-xs text-ink-500 min-w-[3.5rem]">#{t.id}</code>
                                <span className="font-mono text-xs text-ink-100 flex-1">{t.raw_label}</span>
                                {confirming ? (
                                  <span className="flex items-center gap-1">
                                    <button
                                      className="px-2 py-0.5 rounded-md bg-clay-300 text-ink-950 text-xs font-medium hover:bg-clay-200 transition disabled:opacity-40"
                                      disabled={deleteTxMut.isPending}
                                      onClick={() => deleteTxMut.mutate(t.id)}
                                    >{deleteTxMut.isPending ? '…' : 'Supprimer'}</button>
                                    <button
                                      className="px-2 py-0.5 rounded-md border border-ink-700 text-ink-200 text-xs hover:bg-ink-850 transition"
                                      onClick={() => { setConfirmDeleteTxId(null); setDupDeleteError(null); }}
                                    >Annuler</button>
                                  </span>
                                ) : (
                                  <button
                                    className="text-ink-500 hover:text-clay-300 transition px-1"
                                    onClick={() => { setConfirmDeleteTxId(t.id); setDupDeleteError(null); }}
                                    title={`Supprimer la transaction #${t.id}`}
                                    aria-label="Supprimer cette transaction"
                                  >🗑</button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        {dupDeleteError && confirmDeleteTxId !== null &&
                          g.transactions.some((t) => t.id === confirmDeleteTxId) && (
                            <p className="mt-2 text-xs text-clay-300">{dupDeleteError}</p>
                          )}
                      </td>
                      <td className="px-4 py-2.5 text-right align-top">
                        <button
                          className="text-xs text-sage-300 hover:text-sage-200 border border-sage-300/40 hover:border-sage-300 rounded-md px-2 py-1 transition disabled:opacity-40"
                          disabled={markNotDuplicateMut.isPending}
                          onClick={() => markNotDuplicateMut.mutate(g.transactions.map((t) => t.id))}
                          title="Marquer chaque ligne du groupe comme validée — le groupe ne réapparaîtra que si une nouvelle ligne du même montant/date arrive plus tard."
                        >
                          ✓ Pas un doublon
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

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
