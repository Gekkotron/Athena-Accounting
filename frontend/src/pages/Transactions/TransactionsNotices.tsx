import { useTranslation } from 'react-i18next';

type Props = {
  sourceFileId: number | undefined;
  onClearSourceFile: () => void;
  bulkCategorizeNotice: { skipped: number } | null;
  onDismissBulkCategorizeNotice: () => void;
  bulkCategorizeError: string | null;
  onDismissBulkCategorizeError: () => void;
  checkpointError: string | null;
  onDismissCheckpointError: () => void;
};

export function TransactionsNotices({
  sourceFileId,
  onClearSourceFile,
  bulkCategorizeNotice,
  onDismissBulkCategorizeNotice,
  bulkCategorizeError,
  onDismissBulkCategorizeError,
  checkpointError,
  onDismissCheckpointError,
}: Props) {
  const { t } = useTranslation(['transactions', 'common']);
  return (
    <>
      {sourceFileId != null && (
        <div className="rounded-lg border border-sage-800/40 bg-sage-900/10 px-3 py-2 flex items-center justify-between gap-3 text-xs">
          <span className="text-ink-200">
            {t('sourceFileFilter.prefix')}{' '}
            <span className="font-mono text-sage-300">#{sourceFileId}</span>{' '}
            <span className="text-ink-500">{t('sourceFileFilter.suffix')}</span>
          </span>
          <button
            className="text-ink-500 hover:text-ink-100 transition"
            onClick={onClearSourceFile}
          >
            {t('sourceFileFilter.remove')}
          </button>
        </div>
      )}

      {bulkCategorizeNotice && (
        <div className="rounded-lg border border-sage-800/40 bg-sage-900/10 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-ink-200">
            {t('bulkCategorize.skippedNotice', { count: bulkCategorizeNotice.skipped })}
          </span>
          <button
            className="text-[11px] text-ink-500 hover:text-ink-100 transition"
            onClick={onDismissBulkCategorizeNotice}
          >
            {t('close', { ns: 'common' })}
          </button>
        </div>
      )}

      {bulkCategorizeError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/15 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-clay-200">
            {t('bulkCategorize.errorPrefix', { message: bulkCategorizeError })}
          </span>
          <button
            className="text-[11px] text-ink-500 hover:text-ink-100 transition"
            onClick={onDismissBulkCategorizeError}
          >
            {t('close', { ns: 'common' })}
          </button>
        </div>
      )}

      {checkpointError && (
        <div className="rounded-lg border border-clay-800/60 bg-clay-900/15 px-4 py-2 flex items-center justify-between gap-3 text-sm">
          <span className="text-clay-200">
            {t('checkpoint.errorPrefix', { message: checkpointError })}
          </span>
          <button
            className="text-[11px] text-ink-500 hover:text-ink-100 transition"
            onClick={onDismissCheckpointError}
          >
            {t('close', { ns: 'common' })}
          </button>
        </div>
      )}
    </>
  );
}
