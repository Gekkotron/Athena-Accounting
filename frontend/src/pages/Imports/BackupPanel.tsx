import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('imports');
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
      setBackupError(err instanceof Error ? err.message : t('backup.export.failedFallback'));
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
      setBackupError(t('backup.import.invalidFile'));
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
        <div className="section-rule mb-4">{t('backup.sectionTitle')}</div>
        <div className="surface p-5 md:p-6 flex flex-col gap-4">
          <p className="text-sm text-ink-400 max-w-2xl">
            <span className="display-italic">{t('backup.description.exportWord')}</span>{' '}
            {t('backup.description.exportText')}{' '}
            <span className="display-italic">{t('backup.description.importWord')}</span>{' '}
            {t('backup.description.importText')}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-primary"
              onClick={exportBackup}
              disabled={exporting}
            >
              {exporting ? t('backup.export.exporting') : t('backup.export.idle')}
            </button>

            <label className="btn-secondary cursor-pointer">
              {importBackupMut.isPending ? t('backup.import.pending') : t('backup.import.idle')}
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
              <div className="text-sage-200 font-medium mb-1">{t('backup.result.header')}</div>
              <div className="text-ink-300 font-mono text-xs leading-relaxed">
                {t('backup.result.accounts', { count: backupResult.imported.accounts })} ·{' '}
                {t('backup.result.categories', { count: backupResult.imported.categories })} ·{' '}
                {t('backup.result.rules', { count: backupResult.imported.rules })} ·{' '}
                {t('backup.result.patterns', { count: backupResult.imported.accountFilenamePatterns })} ·{' '}
                {t('backup.result.transactions', { count: backupResult.imported.transactions })}
                {backupResult.imported.fileImports !== undefined && (
                  <> · {t('backup.result.fileImports', { count: backupResult.imported.fileImports })}</>
                )}
                {backupResult.imported.balanceCheckpoints !== undefined && (
                  <> · {t('backup.result.checkpoints', { count: backupResult.imported.balanceCheckpoints })}</>
                )}
                {backupResult.imported.transferRules > 0 && (
                  <> · {t('backup.result.transferRules', { count: backupResult.imported.transferRules })}</>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!pendingImport}
        title={t('backup.confirmDialog.title')}
        description={
          <>
            <span className="display-italic">{t('backup.confirmDialog.descriptionPrefix')}</span>{' '}
            {t('backup.confirmDialog.descriptionMiddle')} <span className="display-italic">{t('backup.confirmDialog.descriptionErased')}</span>
            {' '}{t('backup.confirmDialog.descriptionSuffix')}
          </>
        }
        confirmLabel={t('backup.confirmDialog.confirmLabel')}
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
