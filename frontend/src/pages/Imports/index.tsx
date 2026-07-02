import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload, ApiError } from '../../api/client';
import type { Account, FileImport } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { submitPdf, type PdfImportNeedsTemplate, type PdfImportImported } from '../../api/pdf-templates';
import { BackupPanel } from './BackupPanel';
import { PdfTemplateWizard } from './PdfTemplateWizard';
import { DuplicatesPanel } from './DuplicatesPanel';
import { FileImportsList } from './FileImportsList';

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

      <FileImportsList
        imports={importsQ.data?.imports ?? []}
        accounts={accountsQ.data?.accounts ?? []}
        onRequestDelete={(fi) => { setDeleteError(null); setPendingDeleteImport(fi); }}
      />
    </div>
  );
}
