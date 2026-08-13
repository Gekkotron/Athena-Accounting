import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from '../../api/client';
import type { Attachment } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorMessage } from '../../api/errorMessage';

// Client-side surface for the /api/transactions/:id/attachments channel
// shipped in Task 1. Kept in its own file (rather than inlined into
// TransactionModal.tsx) so the modal stays under the frontend max-lines
// ceiling and so the section can be reused elsewhere later.

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  // null while the modal is in create mode — a transaction id is required to
  // attach a file, so we render an explanatory hint instead of the upload UI.
  transactionId: number | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function TransactionAttachments({ transactionId }: Props): JSX.Element {
  const { t } = useTranslation(['transactions', 'common']);
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmDeleteName, setConfirmDeleteName] = useState<string>('');

  const listQ = useQuery({
    queryKey: ['attachments', transactionId],
    enabled: transactionId != null,
    queryFn: () =>
      api<{ attachments: Attachment[] }>(`/api/transactions/${transactionId}/attachments`),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) =>
      apiUpload<{ attachment: Attachment }>(
        `/api/transactions/${transactionId}/attachments`,
        file,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attachments', transactionId] });
      // The transactions list carries `attachmentCount` per row for the
      // paperclip indicator — invalidate so the list picks up the +1.
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      setUploadError(null);
    },
    onError: (err) => setUploadError(errorMessage(err, t)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      api<void>(`/api/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attachments', transactionId] });
      void qc.invalidateQueries({ queryKey: ['transactions'] });
      setConfirmDeleteId(null);
    },
  });

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file after an error
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setUploadError(t('attachments.tooLarge'));
      return;
    }
    setUploadError(null);
    uploadMut.mutate(file);
  }

  if (transactionId == null) {
    return (
      <section className="mt-6">
        <div className="label mb-2">{t('attachments.sectionTitle')}</div>
        <div className="text-sm text-ink-500 display-italic">
          {t('attachments.saveFirstHint')}
        </div>
      </section>
    );
  }

  const rows = listQ.data?.attachments ?? [];

  return (
    <section className="mt-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="label">{t('attachments.sectionTitle')}</div>
        <div className="flex-1 h-px bg-ink-800" />
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => fileInput.current?.click()}
          disabled={uploadMut.isPending}
        >
          {uploadMut.isPending ? t('attachments.uploading') : t('attachments.addButton')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={handlePick}
        />
      </div>

      {uploadError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200 mb-2">
          {uploadError}
        </div>
      )}

      {listQ.isLoading ? (
        <div className="text-sm text-ink-500 display-italic">{t('attachments.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-ink-500 display-italic">{t('attachments.empty')}</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-3 rounded-md bg-ink-900/40 px-3 py-2 text-sm"
            >
              <span className="flex-1 min-w-0 truncate text-ink-100">{att.filename}</span>
              <span className="font-mono tabular-nums text-xs text-ink-400 shrink-0">
                {formatSize(att.sizeBytes)}
              </span>
              <a
                className="text-xs text-sage-300 hover:text-sage-200"
                href={`/api/attachments/${att.id}/download`}
                download={att.filename}
              >
                {t('attachments.download')}
              </a>
              <button
                type="button"
                className="text-xs text-clay-300 hover:text-clay-200"
                onClick={() => {
                  setConfirmDeleteId(att.id);
                  setConfirmDeleteName(att.filename);
                }}
              >
                {t('attachments.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirmDeleteId != null}
        title={t('attachments.confirmDeleteTitle')}
        description={t('attachments.confirmDeleteDescription', { name: confirmDeleteName })}
        destructive
        busy={deleteMut.isPending}
        error={deleteMut.error ? errorMessage(deleteMut.error, t) : null}
        onConfirm={() => confirmDeleteId != null && deleteMut.mutate(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </section>
  );
}
