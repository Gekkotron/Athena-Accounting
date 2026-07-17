import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { Account } from '../../api/types';
import { submitPdf, submitPhoto, type PdfImportNeedsTemplate, type PdfImportImported } from '../../api/pdf-templates';
import { errorMessage } from '../../api/errorMessage';
import { useImportPreview } from './useImportPreview';
import { ImportPreviewModal } from './ImportPreviewModal';
import { runOne } from './run-import';
import { collectDroppedFiles } from './drop-utils';
import { BatchSummaryPanel, type BatchState } from './BatchSummaryPanel';
import { useBatchRetry } from './useBatchRetry';

export function UploadForm({
  accounts,
  onPdfNeedsTemplate,
  onPdfImported,
  onOfxCsvSuccess,
  onFileSelected,
}: {
  accounts: Account[];
  onPdfNeedsTemplate: (
    payload: PdfImportNeedsTemplate,
    ctx?: { resolve: (success: boolean) => void },
  ) => void;
  onPdfImported: (payload: PdfImportImported) => void;
  onOfxCsvSuccess: (result: any) => void;
  onFileSelected: () => void;
}): JSX.Element {
  const { t } = useTranslation('imports');
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchState | null>(null);
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

  const [dragOver, setDragOver] = useState(false);
  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (pending) return;
    const collected = await collectDroppedFiles(e.dataTransfer);
    const kept = collected.filter((f) => acceptFile(f.name));
    setFiles(kept);
    setError(null);
    onFileSelected();
  };

  const invalidateAll = () => {
    for (const key of ['imports', 'transactions', 'accounts', 'reports', 'tri-groups', 'transaction-duplicates']) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const previewCtl = useImportPreview({
    onImported: (r) => onOfxCsvSuccess(r),
    onError: (msg) => setError(msg),
    onSuccess: () => {
      setFiles([]);
      if (fileRef.current) fileRef.current.value = '';
    },
    invalidate: invalidateAll,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Photo path takes priority over the file batch when both inputs carry a
    // value — the two are independent inputs, but a single submit can only
    // drive one request.
    if (photo) {
      if (accountId === '') {
        setError(t('uploadForm.errors.accountRequiredPhoto'));
        return;
      }
      setError(null);
      setBatch(null);
      try {
        const r = await submitPhoto(photo, accountId as number);
        if (r.kind === 'imported') {
          invalidateAll();
          onPdfImported(r);
        } else {
          onPdfNeedsTemplate(r);
        }
        setPhoto(null);
        if (photoRef.current) photoRef.current.value = '';
      } catch (err) {
        setError(err instanceof Error ? err.message : t('uploadForm.errors.photoImportFailed'));
      }
      return;
    }

    if (files.length === 0) return;

    const hasAnyPdf = files.some((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (hasAnyPdf && accountId === '') {
      setError(t('uploadForm.errors.accountRequiredPdf'));
      return;
    }

    if (files.length === 1) {
      const f = files[0]!;
      setError(null);
      setBatch(null);
      if (f.name.toLowerCase().endsWith('.pdf')) {
        setBatch({ phase: 'running', current: 1, total: 1, currentName: f.name });
        try {
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
          setError(err instanceof Error ? errorMessage(err, t) : t('uploadForm.errors.pdfImportFailed'));
        } finally {
          setBatch(null);
        }
        return;
      }
      await previewCtl.start(f, accountId ? (accountId as number) : undefined);
      return;
    }

    // Batch: PDFs that need a template are deferred to the summary rather than
    // opening the wizard mid-loop (that would strand the remaining files).
    setError(null);
    const total = files.length;
    let inserted = 0;
    let skipped = 0;
    let imported = 0;
    const needsTemplate: string[] = [];
    const errors: { file: File; message: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      setBatch({ phase: 'running', current: i + 1, total, currentName: f.name });
      const r = await runOne(f, accountId, t);
      if (r.ok) {
        imported++;
        inserted += r.inserted;
        skipped += r.skipped;
      } else if ('needsTemplate' in r) {
        needsTemplate.push(f.name);
      } else {
        errors.push({ file: f, message: r.message });
      }
    }

    invalidateAll();
    setBatch({ phase: 'done', imported, inserted, skipped, needsTemplate, errors });
    setFiles([]);
    if (fileRef.current) fileRef.current.value = '';
    if (folderRef.current) folderRef.current.value = '';
  };

  const { retryOne, retryAll } = useBatchRetry({
    batch, setBatch, accountId, invalidate: invalidateAll,
    onNeedsTemplate: (r) => new Promise<boolean>((resolve) => onPdfNeedsTemplate(r, { resolve })),
  });

  return (
    <>
      <form onSubmit={submit} className="surface p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div
            data-testid="upload-drop-zone"
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            className={`flex flex-col gap-1.5 flex-1 min-w-0 rounded-lg border-2 border-dashed p-3 transition ${dragOver ? 'border-sage-400 bg-sage-900/10' : 'border-ink-800/60'}`}
          >
            <label className="label">
              {t('uploadForm.dropzone.label')}
              <span className="ml-2 text-[10px] font-normal text-ink-500">
                {t('uploadForm.dropzone.hint')} <span className="underline">{t('uploadForm.dropzone.browse')}</span>
              </span>
            </label>
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
                {t('uploadForm.chooseFolder')}
              </button>
              {files.length > 1 && (
                <span className="font-mono text-ink-400">
                  {t('uploadForm.filesSelected', { count: files.length })}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 w-full md:w-60">
            <label className="label">{t('uploadForm.accountLabel')}</label>
            <select
              className="input"
              aria-label={t('uploadForm.accountLabel')}
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

          <button className="btn-primary" disabled={(files.length === 0 && !photo) || pending}>
            {pending
              ? t('uploadForm.submit.importing')
              : files.length > 1
                ? t('uploadForm.submit.many', { count: files.length })
                : t('uploadForm.submit.one')}
          </button>
        </div>

        <div className="flex flex-col gap-1.5 mt-4 pt-4 border-t border-ink-800/60">
          <label htmlFor="photo-input" className="label">{t('uploadForm.photoLabel')}</label>
          <input
            id="photo-input"
            ref={photoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            disabled={pending}
            className="block text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sage-300 file:text-ink-950 file:px-4 file:py-2 file:text-sm file:font-medium hover:file:bg-sage-200 file:transition file:cursor-pointer"
          />
        </div>
      </form>

      {batch && (
        <BatchSummaryPanel
          batch={batch}
          onRetryOne={retryOne}
          onRetryAll={retryAll}
          onClose={() => setBatch(null)}
        />
      )}

      {previewCtl.preview && (
        <ImportPreviewModal
          preview={previewCtl.preview}
          onConfirm={previewCtl.confirm}
          onCancel={previewCtl.cancel}
          pending={previewCtl.pending}
        />
      )}

      {error && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-4 py-3 text-sm text-clay-200">
          {error}
        </div>
      )}
    </>
  );
}
