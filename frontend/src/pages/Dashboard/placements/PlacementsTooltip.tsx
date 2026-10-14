import { useTranslation } from 'react-i18next';
import { formatAmount, formatDate } from '../../../lib/format';
import type { PlacementPoint } from './series';

interface Props {
  point: PlacementPoint;
  currency: string;
  x: number;
  y: number;
  containerWidth: number;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function signedAmount(n: number, currency: string): string {
  return `${n > 0 ? '+' : ''}${formatAmount(n, currency)}`;
}

export function PlacementsTooltip({ point, currency, x, y, containerWidth }: Props): JSX.Element {
  const { t } = useTranslation('dashboard');
  const gainClass = point.gain > 0 ? 'text-sage-300' : point.gain < 0 ? 'text-clay-300' : 'text-ink-300';
  return (
    <div
      className="absolute pointer-events-none surface px-3 py-2 shadow-card min-w-[160px]"
      style={{
        left: clamp(x, 90, containerWidth - 90),
        top: y,
        transform: 'translate(-50%, calc(-100% - 14px))',
      }}
    >
      <div className="font-mono text-[10px] text-ink-500 mb-1">
        {formatDate(point.date)}
        {point.estimated && <span className="ml-1.5 italic">· {t('placements.tooltip.estimated')}</span>}
      </div>
      <div className="font-mono text-xs tabular-nums flex flex-col gap-0.5">
        <div className="flex justify-between gap-4">
          <span className="text-ink-400">{t('placements.tooltip.value')}</span>
          <span className="text-ink-100 private">{formatAmount(point.value, currency)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-ink-400">{t('placements.tooltip.contributed')}</span>
          <span className="text-ink-300 private">{formatAmount(point.contributed, currency)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-ink-400">{t('placements.tooltip.gain')}</span>
          <span className={`${gainClass} private`}>{signedAmount(point.gain, currency)}</span>
        </div>
      </div>
    </div>
  );
}
