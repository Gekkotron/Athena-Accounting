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
              </div>
            </div>
          )}
        </div>
      </section>

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
                </tr>
              </thead>
              <tbody>
                {(importsQ.data?.imports ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-ink-500 display-italic">
                      Aucun import pour l'instant.
                    </td>
                  </tr>
                ) : (
                  (importsQ.data?.imports ?? []).map((i) => (
                    <tr key={i.id} className="border-b border-ink-800/40 last:border-0">
                      <td className="px-4 py-2.5 text-ink-100 font-mono text-xs">{i.filename}</td>
                      <td className="px-4 py-2.5 text-ink-300">{accountName(i.accountId)}</td>
                      <td className="px-4 py-2.5"><span className="badge">{i.format}</span></td>
                      <td className="px-4 py-2.5 text-right text-ink-300 font-mono">{i.totalLines}</td>
                      <td className="px-4 py-2.5 text-right text-sage-300 font-mono">{i.insertedCount}</td>
                      <td className="px-4 py-2.5 text-right text-ink-400 font-mono">{i.dedupSkipped}</td>
                      <td className="px-4 py-2.5 text-ink-400 text-xs whitespace-nowrap">{formatDateTime(i.importedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
