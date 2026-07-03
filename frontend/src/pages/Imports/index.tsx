import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Account, FileImport } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { PdfImportNeedsTemplate, PdfImportImported } from '../../api/pdf-templates';
import { BackupPanel } from './BackupPanel';
import { PdfTemplateWizard } from './PdfTemplateWizard';
import { PdfTemplatesPanel } from './PdfTemplatesPanel';
import { DuplicatesPanel } from './DuplicatesPanel';
import { FileImportsList } from './FileImportsList';
import { UploadForm } from './UploadForm';

export function Imports() {
  const qc = useQueryClient();

  const [lastResult, setLastResult] = useState<{
    filename: string;
    inserted: number;
    skipped: number;
    total: number;
  } | null>(null);

  // PDF-specific state
  const [needsTpl, setNeedsTpl] = useState<PdfImportNeedsTemplate | null>(null);
  const [lastImported, setLastImported] = useState<PdfImportImported | null>(null);

  const accountsQ = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<{ accounts: Account[] }>('/api/accounts'),
  });
  const importsQ = useQuery({
    queryKey: ['imports'],
    queryFn: () => api<{ imports: FileImport[] }>('/api/imports'),
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

      <UploadForm
        accounts={accountsQ.data?.accounts ?? []}
        onPdfNeedsTemplate={(p) => { setNeedsTpl(p); setLastImported(null); }}
        onPdfImported={(p) => { setLastImported(p); setNeedsTpl(null); }}
        onOfxCsvSuccess={(r) => { setLastResult(r); }}
        onFileSelected={() => {
          setLastResult(null);
          setLastImported(null);
          setNeedsTpl(null);
        }}
      />

      <PdfTemplateWizard
        needsTpl={needsTpl}
        lastImported={lastImported}
        accountId={''}
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

      <PdfTemplatesPanel />
    </div>
  );
}
