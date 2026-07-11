import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiUpload, ApiError } from '../../api/client';
import type { Account } from '../../api/types';
import { submitPdf, type PdfImportNeedsTemplate, type PdfImportImported } from '../../api/pdf-templates';

export function UploadForm({
  accounts,
  onPdfNeedsTemplate,
  onPdfImported,
  onOfxCsvSuccess,
  onFileSelected,
}: {
  accounts: Account[];
  onPdfNeedsTemplate: (payload: PdfImportNeedsTemplate) => void;
  onPdfImported: (payload: PdfImportImported) => void;
  onOfxCsvSuccess: (result: any) => void;
  onFileSelected: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<
    | { phase: 'running'; current: number; total: number; currentName: string }
    | { phase: 'done'; imported: number; inserted: number; skipped: number; needsTemplate: string[]; errors: { file: string; message: string }[] }
    | null
  >(null);
  const pending = batch?.phase === 'running';

  // Bank statements only ship as .ofx/.qfx/.csv/.pdf. Drop anything else so a
  // stray Thumbs.db / .DS_Store from a directory pick doesn't blow up the loop.
  const acceptFile = (name: string) => /\.(ofx|qfx|csv|pdf)$/i.test(name);

  const pickFiles = (list: FileList | null) => {
    if (!list) { setFiles([]); return; }
    const kept = Array.from(list).filter((f) => acceptFile(f.name));
    setFiles(kept);
    setError(null);
    onFileSelected();
  };

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['imports'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['reports'] });
    qc.invalidateQueries({ queryKey: ['tri-groups'] });
    qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;

    const hasAnyPdf = files.some((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (hasAnyPdf && accountId === '') {
      setError('Veuillez sélectionner un compte pour importer des PDF.');
      return;
    }

    // Single-file path: preserve the original behavior exactly — PDF
    // needs_template routes to the wizard, OFX/CSV fires the banner. No batch
    // summary UI, no aggregation.
    if (files.length === 1) {
      const f = files[0]!;
      setError(null);
      setBatch(null);
      if (f.name.toLowerCase().endsWith('.pdf')) {
        setBatch({ phase: 'running', current: 1, total: 1, currentName: f.name });
        try {
          // accountId is guaranteed non-'' here — the top-of-submit guard
          // rejects any PDF-containing selection when accountId is empty.
          const r = await submitPdf(f, accountId as number);
          if (r.kind === 'imported') {
            invalidateAll();
            onPdfImported(r);
            setFiles([]);
            if (fileRef.current) fileRef.current.value = '';
          } else {
            onPdfNeedsTemplate(r);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Erreur lors de l\'import PDF.');
        } finally {
          setBatch(null);
        }
        return;
      }
      // OFX / CSV
      try {
        const data = await apiUpload<{
          filename: string;
          insertedCount: number;
          dedupSkipped: number;
          totalLines: number;
        }>('/api/imports', f, { query: accountId ? { accountId } : undefined });
        onOfxCsvSuccess({
          filename: f.name,
          inserted: data.insertedCount,
          skipped: data.dedupSkipped,
          total: data.totalLines,
        });
        invalidateAll();
        setFiles([]);
        if (fileRef.current) fileRef.current.value = '';
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Erreur lors de l\'import.');
      }
      return;
    }

    // Batch path: process files sequentially. PDFs that need a template are
    // deferred (surfaced in the summary) rather than opening the wizard mid-
    // batch — that would strand the remaining files.
    setError(null);
    const total = files.length;
    let inserted = 0;
    let skipped = 0;
    let imported = 0;
    const needsTemplate: string[] = [];
    const errors: { file: string; message: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      setBatch({ phase: 'running', current: i + 1, total, currentName: f.name });
      try {
        if (f.name.toLowerCase().endsWith('.pdf')) {
          // accountId is guaranteed non-'' here — the top-of-submit guard
          // rejects any PDF-containing selection when accountId is empty.
          const r = await submitPdf(f, accountId as number);
          if (r.kind === 'imported') {
            imported++;
            inserted += r.result.insertedCount;
            skipped += r.result.dedupSkipped;
          } else {
            needsTemplate.push(f.name);
          }
        } else {
          const data = await apiUpload<{
            filename: string;
            insertedCount: number;
            dedupSkipped: number;
            totalLines: number;
          }>('/api/imports', f, { query: accountId ? { accountId } : undefined });
          imported++;
          inserted += data.insertedCount;
          skipped += data.dedupSkipped;
        }
      } catch (err) {
        errors.push({
          file: f.name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    invalidateAll();
    setBatch({ phase: 'done', imported, inserted, skipped, needsTemplate, errors });
    setFiles([]);
    if (fileRef.current) fileRef.current.value = '';
    if (folderRef.current) folderRef.current.value = '';
  };

  return (
    <>
      <form onSubmit={submit} className="surface p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <label className="label">Fichier(s) — .ofx · .qfx · .csv · .pdf</label>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".ofx,.qfx,.csv,.pdf"
              onChange={(e) => pickFiles(e.target.files)}
              disabled={pending}
              className="block text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sage-300 file:text-ink-950 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-sage-200 file:transition file:cursor-pointer"
            />
            <input
              ref={folderRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is a non-standard HTMLInputElement attribute.
              webkitdirectory=""
              directory=""
              className="hidden"
              onChange={(e) => pickFiles(e.target.files)}
              disabled={pending}
            />
            <div className="flex items-center gap-3 text-[11px] text-ink-500">
              <button
                type="button"
                className="hover:text-ink-100 transition underline-offset-2 hover:underline disabled:opacity-40"
                disabled={pending}
                onClick={() => folderRef.current?.click()}
              >
                ou choisir un dossier
              </button>
              {files.length > 1 && (
                <span className="font-mono text-ink-400">
                  {files.length} fichiers sélectionnés
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 w-full md:w-60">
            <label className="label">Compte</label>
            <select
              className="input"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
              disabled={pending}
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <button className="btn-primary" disabled={files.length === 0 || pending}>
            {pending
              ? 'Import…'
              : files.length > 1
              ? `Importer ${files.length} fichiers`
              : 'Importer'}
          </button>
        </div>
      </form>

      {batch?.phase === 'running' && batch.total > 1 && (
        <div className="rounded-lg border border-ink-800/60 bg-ink-900/50 px-4 py-3 text-sm text-ink-200">
          Traitement… <span className="font-mono">{batch.current} / {batch.total}</span>{' '}
          <span className="text-ink-500">— {batch.currentName}</span>
        </div>
      )}

      {batch?.phase === 'done' && (
        <div className="rounded-lg border border-sage-800/40 bg-sage-900/15 px-4 py-3 text-sm text-ink-100 space-y-1">
          <div>
            <span className="font-mono">{batch.imported}</span> fichier{batch.imported > 1 ? 's' : ''} importé{batch.imported > 1 ? 's' : ''} ·{' '}
            <span className="font-mono">{batch.inserted}</span> insérée{batch.inserted > 1 ? 's' : ''} ·{' '}
            <span className="font-mono">{batch.skipped}</span> dédupliquée{batch.skipped > 1 ? 's' : ''}
          </div>
          {batch.needsTemplate.length > 0 && (
            <div className="text-amber-300/90 text-xs">
              {batch.needsTemplate.length} PDF nécessite{batch.needsTemplate.length > 1 ? 'nt' : ''} un template — importez-les individuellement&nbsp;: {batch.needsTemplate.join(', ')}
            </div>
          )}
          {batch.errors.length > 0 && (
            <details className="text-clay-300 text-xs">
              <summary className="cursor-pointer">
                {batch.errors.length} en erreur
              </summary>
              <ul className="mt-1 space-y-0.5 pl-2">
                {batch.errors.map((e) => (
                  <li key={e.file} className="font-mono">
                    {e.file}: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            type="button"
            className="text-[11px] text-ink-500 hover:text-ink-100 transition"
            onClick={() => setBatch(null)}
          >
            Fermer
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
          {error}
        </div>
      )}
    </>
  );
}
