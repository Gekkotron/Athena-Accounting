import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiUpload, ApiError } from '../../api/client';
import type { Account } from '../../api/types';
import { submitPdf, type PdfImportNeedsTemplate, type PdfImportImported } from '../../api/pdf-templates';

export function UploadForm({
  accounts,
  onPdfNeedsTemplate,
  onPdfImported,
  onOfxCsvSuccess,
}: {
  accounts: Account[];
  onPdfNeedsTemplate: (payload: PdfImportNeedsTemplate) => void;
  onPdfImported: (payload: PdfImportImported) => void;
  onOfxCsvSuccess: (result: any) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [pdfPending, setPdfPending] = useState(false);

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
      onOfxCsvSuccess({
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
      setPdfPending(true);
      try {
        const r = await submitPdf(file, accountId);
        if (r.kind === 'imported') {
          onPdfImported(r);
          qc.invalidateQueries({ queryKey: ['imports'] });
          qc.invalidateQueries({ queryKey: ['transactions'] });
          qc.invalidateQueries({ queryKey: ['accounts'] });
          qc.invalidateQueries({ queryKey: ['reports'] });
          qc.invalidateQueries({ queryKey: ['tri-groups'] });
          qc.invalidateQueries({ queryKey: ['transaction-duplicates'] });
          setFile(null);
          if (fileRef.current) fileRef.current.value = '';
        } else {
          onPdfNeedsTemplate(r);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur lors de l\'import PDF.');
      } finally {
        setPdfPending(false);
      }
      return;
    }

    setError(null);
    upload.mutate({ file, accountId });
  };

  return (
    <>
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
    </>
  );
}
