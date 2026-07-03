import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface BackupResult {
  imported: {
    accounts: number;
    categories: number;
    accountFilenamePatterns: number;
    rules: number;
    // Legacy — kept in the response for backward compat with backups that
    // still carry transfer rules. New exports emit 0 here.
    transferRules: number;
    // Per-account balance checkpoints restored from the dump.
    balanceCheckpoints?: number;
    transactions: number;
    fileImports?: number;
  };
}

export function BackupPanel(): JSX.Element {
  const qc = useQueryClient();
  const backupFileRef = useRef<HTMLInputElement>(null);

  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [exporting, setExporting] = useState(false);
  // Holds the parsed JSON between the user picking a file and confirming
  // the destructive import in the dialog.
  const [pendingImport, setPendingImport] = useState<unknown | null>(null);

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
    <>
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
                {backupResult.imported.rules} règle(s) ·{' '}
                {backupResult.imported.accountFilenamePatterns} motif(s) ·{' '}
                {backupResult.imported.transactions} transaction(s)
                {backupResult.imported.fileImports !== undefined && (
                  <> · {backupResult.imported.fileImports} import(s)</>
                )}
                {backupResult.imported.balanceCheckpoints !== undefined && (
                  <> · {backupResult.imported.balanceCheckpoints} point(s) de contrôle</>
                )}
                {backupResult.imported.transferRules > 0 && (
                  <> · {backupResult.imported.transferRules} règle(s) de transfert (héritées)</>
                )}
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
    </>
  );
}
