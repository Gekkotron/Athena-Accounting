import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { previewImport, type ImportPreview } from '../../api/imports';
import { apiUpload, ApiError } from '../../api/client';

interface OfxCsvSuccess {
  filename: string;
  inserted: number;
  skipped: number;
  total: number;
}

export function useImportPreview(opts: {
  onImported: (result: OfxCsvSuccess) => void;
  onError: (message: string) => void;
  onSuccess: () => void;
  invalidate: () => void;
}) {
  const { t } = useTranslation('imports');
  const [state, setState] = useState<{
    file: File;
    data: ImportPreview;
    confirming: boolean;
  } | null>(null);

  const start = async (file: File, accountId?: number) => {
    try {
      const data = await previewImport(file, accountId);
      setState({ file, data, confirming: false });
    } catch (err) {
      opts.onError(err instanceof ApiError ? err.message : t('errors.previewFailed'));
    }
  };

  const confirm = async () => {
    if (!state) return;
    setState({ ...state, confirming: true });
    try {
      const data = await apiUpload<{
        filename: string; insertedCount: number; dedupSkipped: number; totalLines: number;
      }>('/api/imports', state.file, {
        query: state.data.accountId ? { accountId: state.data.accountId } : undefined,
      });
      opts.onImported({
        filename: state.file.name,
        inserted: data.insertedCount,
        skipped: data.dedupSkipped,
        total: data.totalLines,
      });
      opts.invalidate();
      setState(null);
      opts.onSuccess();
    } catch (err) {
      opts.onError(err instanceof ApiError ? err.message : t('errors.importFailed'));
      setState(null);
    }
  };

  const cancel = () => setState(null);

  return { preview: state?.data ?? null, pending: state?.confirming ?? false, start, confirm, cancel };
}
