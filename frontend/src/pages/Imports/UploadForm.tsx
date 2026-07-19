import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { Account } from '../../api/types';
import { submitPdf, submitPhoto, type PdfImportNeedsTemplate, type PdfImportImported, type PdfImportResponse } from '../../api/pdf-templates';
import { errorMessage } from '../../api/errorMessage';
import { useImportPreview } from './useImportPreview';
import { ImportPreviewModal } from './ImportPreviewModal';
import { runOne, isPdfFile, isImageFile } from './run-import';
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

  const [files, setFiles] = useState<File[]>([]);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const pending = batch?.phase === 'running';

  // Bank statements ship as .ofx/.qfx/.csv/.pdf; scanned statements as JPEG/PNG/HEIC.
  // Drop anything else so a stray Thumbs.db / .DS_Store from a directory pick
  // doesn't blow up the loop.
  const acceptFile = (name: string) => /\.(ofx|qfx|csv|pdf|jpe?g|png|webp|heic)$/i.test(name);

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

  // Route a PDF or image through the OCR-aware pipeline: PDFs try the text
  // layer first, then fall back to /api/imports/photo when the backend reports
  // no_text_layer; images go straight to OCR since they have no text layer at all.
  const runPdfOrImage = async (f: File): Promise<PdfImportResponse> => {
    let r = await submitPdf(f, accountId as number);
    if (isPdfFile(f.name) && r.kind === 'needs_template' && r.reason === 'no_text_layer') {
      r = await submitPhoto(f, accountId as number);
    }
    return r;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (files.length === 0) return;

    const needsAccount = files.some((f) => isPdfFile(f.name) || isImageFile(f.name));
    if (needsAccount && accountId === '') {
      setError(t('uploadForm.errors.accountRequiredPdf'));
      return;
    }

    if (files.length === 1) {
      const f = files[0]!;
      setError(null);
      setBatch(null);
      if (isPdfFile(f.name) || isImageFile(f.name)) {
        setBatch({ phase: 'running', current: 1, total: 1, currentName: f.name });
        try {
          const r = isPdfFile(f.name)
            ? await runPdfOrImage(f)
            : await submitPhoto(f, accountId as number);
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
              accept=".ofx,.qfx,.csv,.pdf,.jpg,.jpeg,.png,.webp,.heic,image/jpeg,image/png,image/webp,image/heic"
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

          <button className="btn-primary" disabled={files.length === 0 || pending}>
            {pending
              ? t('uploadForm.submit.importing')
              : files.length > 1
                ? t('uploadForm.submit.many', { count: files.length })
                : t('uploadForm.submit.one')}
          </button>
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
