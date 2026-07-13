import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getOcrStatus, type OcrStatusResponse } from '../../api/pdf-templates';

export function OcrProgress({
  draftId, onReady, onError,
}: {
  draftId: number;
  onReady: (r: OcrStatusResponse) => void;
  onError: (msg: string) => void;
}): JSX.Element {
  const q = useQuery({
    queryKey: ['ocr-status', draftId],
    queryFn: () => getOcrStatus(draftId),
    // react-query v5 passes the Query object here (not the resolved data) —
    // read the in-flight/last-settled data off `query.state.data`.
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 1000 : false),
  });
  useEffect(() => {
    if (q.data?.status === 'ready') onReady(q.data);
    if (q.data?.status === 'error') onError(q.data.error ?? 'OCR échec inconnu');
  }, [q.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = q.data?.progress ?? 0;
  const total = q.data?.total ?? 0;
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;

  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="text-lg font-medium text-ink-50">Reconnaissance des caractères</div>
      <div className="text-sm text-ink-400">{progress} / {total} pages</div>
      <div className="w-72 h-2 rounded-full bg-ink-800 overflow-hidden">
        <div className="h-full bg-sage-500 transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {q.data?.status === 'error' && (
        <div className="text-sm text-clay-300 max-w-md text-center">{q.data.error}</div>
      )}
    </div>
  );
}
