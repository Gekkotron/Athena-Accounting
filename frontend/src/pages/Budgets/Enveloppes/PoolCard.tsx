import { useTranslation } from 'react-i18next';
import type { EnvelopeReport } from '../../../api/types';
import { formatAmount } from '../../../lib/format';
import { formatSignedMoney } from '../envelope-math';

export function PoolCard(props: {
  pool: EnvelopeReport['pool'];
  onHoldClick: () => void;
}): JSX.Element {
  const { t } = useTranslation('budgets');
  const negative = Number(props.pool.available) < 0;
  return (
    <div className="surface p-6 flex flex-col gap-3">
      <div className="label">{t('envelopes.pool.title')}</div>
      <div className={`display text-4xl ${negative ? 'text-clay-300' : 'text-ink-50'}`}>
        {formatSignedMoney(props.pool.available)}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-ink-400 mt-2">
        <dt>{t('envelopes.pool.incomeCumulative')}</dt>
        <dd className="text-right">{formatAmount(props.pool.incomeCumulative)}</dd>
        <dt>{t('envelopes.pool.assignedCumulative')}</dt>
        <dd className="text-right">{formatAmount(props.pool.assignedCumulative)}</dd>
        <dt>{t('envelopes.pool.heldFromPriorMonths')}</dt>
        <dd className="text-right">{formatAmount(props.pool.heldFromPriorMonths)}</dd>
        <dt>{t('envelopes.pool.heldForNextMonth')}</dt>
        <dd className="text-right flex items-center justify-end gap-2">
          <span>{formatAmount(props.pool.heldForNextMonth)}</span>
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={props.onHoldClick}>
            {t('envelopes.pool.holdButton')}
          </button>
        </dd>
      </dl>
    </div>
  );
}
