import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deleteLoan, getLoan, type LoanDetail } from '../../api/loans';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorState, LoadingBlock } from '../../components/StateBlocks';
import { SummaryStrip } from './SummaryStrip';
import { CapitalChart } from './CapitalChart';
import { PeriodsTimeline } from './PeriodsTimeline';
import { ScheduleTable } from './ScheduleTable';
import { SourceComparison } from './whatif/SourceComparison';

type Action = (d: LoanDetail) => void;

interface Props {
  id: number;
  onClose: () => void;
  onEdit?: Action;
  onChangePayment?: Action;
  onWhatIf?: Action;
  onDuplicate?: Action;
}

export function LoanDrawer({ id, onClose, onEdit, onChangePayment, onWhatIf, onDuplicate }: Props) {
  const { t } = useTranslation('loans');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['loans', 'detail', id], queryFn: () => getLoan(id) });
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: () => deleteLoan(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['loans'] });
      onClose();
    },
  });
  const d = q.data;
  const actions: Array<[string, Action | undefined]> = [
    ['actions.edit', onEdit],
    ['actions.changePayment', onChangePayment],
    ['actions.whatIf', onWhatIf],
    ['actions.duplicate', onDuplicate],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={d?.loan.name ?? t('title')}
      className="fixed inset-0 z-40 bg-black/50 flex justify-end"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-4xl overflow-y-auto bg-ink-950 border-l border-ink-800 p-4 md:p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="display text-lg text-ink-100">{d?.loan.name ?? ''}</h2>
            {d && <div className="text-[11px] text-ink-500">{t(`kind.${d.loan.kind}`)}</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            {d && actions.map(([key, fn]) => fn && (
              <button key={key} type="button" className="btn-secondary" onClick={() => fn(d)}>{t(key)}</button>
            ))}
            {d && (
              <button type="button" className="btn-secondary" onClick={() => setConfirming(true)}>
                {t('actions.delete')}
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>{t('actions.close')}</button>
          </div>
        </header>

        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !d ? (
          <LoadingBlock />
        ) : d.summary ? (
          <>
            <SummaryStrip summary={d.summary} currency={d.loan.currency} />
            {d.loan.sourceLoanId !== null && (
              <SourceComparison sourceId={d.loan.sourceLoanId} summary={d.summary} currency={d.loan.currency} />
            )}
            <CapitalChart schedule={d.schedule} principal={d.loan.principal} asOf={d.summary.today.asOf} />
            <PeriodsTimeline schedule={d.schedule} currency={d.loan.currency} />
            <ScheduleTable schedule={d.schedule} asOf={d.summary.today.asOf} currency={d.loan.currency} />
          </>
        ) : (
          <div role="alert" className="surface-soft p-4 text-sm text-amber-300">{t('drawer.invalid')}</div>
        )}

        {/* Inside <aside> so clicks in the confirm dialog never reach the backdrop's onClose. */}
        <ConfirmDialog
          open={confirming}
          title={t('deleteConfirm.title')}
          description={t('deleteConfirm.body')}
          confirmLabel={t('deleteConfirm.confirm')}
          destructive
          busy={del.isPending}
          error={del.error instanceof Error ? del.error.message : null}
          onConfirm={() => del.mutate()}
          onCancel={() => setConfirming(false)}
        />
      </aside>
    </div>
  );
}
