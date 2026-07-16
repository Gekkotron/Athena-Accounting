import type { EnvelopeReportRow } from '../../../api/types';
import { formatAmount } from '../../../lib/format';
import { formatSignedMoney, computeTargetProgress } from '../envelope-math';

export function EnvelopeRow(props: {
  row: EnvelopeReportRow;
  assignmentSlot: React.ReactNode;
  onReallocateClick: (row: EnvelopeReportRow) => void;
  onSettingsClick: (row: EnvelopeReportRow) => void;
}): JSX.Element {
  const { row } = props;
  const progress = computeTargetProgress(row);
  const balanceNegative = Number(row.balance) < 0;
  const absorbed = row.overspendPolicy === 'reallocate_manual' && Number(row.absorbedByPool) > 0;
  return (
    <div className="surface p-4 flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_80px_120px_100px_100px_40px] items-center gap-3 text-sm">
        <div className="text-ink-50 font-medium truncate">{row.categoryName}</div>
        <div className="text-ink-400 text-right">{formatAmount(row.balancePriorMonth)}</div>
        <div>{props.assignmentSlot}</div>
        <div className="text-ink-400 text-right">{formatAmount(row.spend)}</div>
        <div className={`text-right ${balanceNegative ? 'text-clay-300' : 'text-sage-300'}`}>
          {absorbed
            ? <span className="text-clay-300">⚠ absorbé</span>
            : formatSignedMoney(row.balance)}
        </div>
        <div className="flex justify-end gap-1">
          <button
            aria-label="Réaffecter"
            className="btn-ghost !py-1 !px-1.5 text-xs"
            onClick={() => props.onReallocateClick(row)}
          >→</button>
          <button
            aria-label="Réglages"
            className="btn-ghost !py-1 !px-1.5 text-xs"
            onClick={() => props.onSettingsClick(row)}
          >⋯</button>
        </div>
      </div>
      {progress && (
        <div className="flex items-center gap-2 text-xs text-ink-400">
          <div className="flex-1 h-1.5 bg-ink-800 rounded">
            <div
              className="h-full bg-sage-500 rounded"
              style={{ width: `${(progress.pct * 100).toFixed(0)}%` }}
            />
          </div>
          <span>{progress.label}</span>
        </div>
      )}
    </div>
  );
}
