import { useTranslation } from 'react-i18next';

type Props = {
  total: number;
  offset: number;
  pageSize: number;
  onOffsetChange: (next: number) => void;
};

export function TransactionsPagination({ total, offset, pageSize, onOffsetChange }: Props) {
  const { t } = useTranslation('transactions');
  return (
    <div className="flex items-center justify-between text-sm text-ink-400">
      <div className="font-mono text-xs">
        {t('pagination.range', {
          from: total === 0 ? 0 : offset + 1,
          to: total === 0 ? 0 : Math.min(offset + pageSize, total),
          total,
        })}
      </div>
      <div className="flex gap-2">
        <button
          className="btn-secondary"
          disabled={offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
        >
          ‹
        </button>
        <button
          className="btn-secondary"
          disabled={offset + pageSize >= total}
          onClick={() => onOffsetChange(offset + pageSize)}
        >
          ›
        </button>
      </div>
    </div>
  );
}
