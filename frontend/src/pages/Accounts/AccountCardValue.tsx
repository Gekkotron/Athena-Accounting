import { useTranslation } from 'react-i18next';
import type { Account } from '../../api/types';
import { formatAmount, amountSignClass, formatDate } from '../../lib/format';
import { todayLocalIso } from '../../lib/dates';
import {
  formatGainPct,
  gainToneClass,
  isValuationStale,
  numberLocale,
  signedAmount,
} from './valuation-lib';

// Valeur / Versé / plus-value block for investment and savings accounts.
// Valeur is the headline; the "au JJ/MM/AAAA" caption only shows when the
// figure comes from a manual valuation (otherwise it is the book balance).
export function AccountCardValue({
  account: a,
  onUpdateValue,
}: {
  account: Account;
  onUpdateValue?: (account: Account) => void;
}) {
  const { t, i18n } = useTranslation('accounts');
  const value = a.value ?? a.currentBalance ?? '0';
  const stale = isValuationStale(a.latestValueDate, todayLocalIso());
  const hasGain = a.gain != null;
  const fmt = (v: string | number) => formatAmount(v, a.currency);
  return (
    <>
      <div className={`display mt-4 text-3xl tabular-nums ${amountSignClass(value)}`}>{fmt(value)}</div>
      {a.latestValueDate && (
        <div
          className={`text-[11px] mt-1 font-mono ${stale ? 'text-amber-300/90' : 'text-ink-500'}`}
          data-testid="valuation-date"
          data-stale={stale ? 'true' : 'false'}
        >
          {t('card.valueAsOf', { date: formatDate(a.latestValueDate) })}
        </div>
      )}
      {a.contributed != null && (
        <div className="text-[11px] text-ink-400 mt-2 font-mono flex justify-between gap-3">
          <span>{t('card.contributed')}</span>
          <span className="private tabular-nums">{fmt(a.contributed)}</span>
        </div>
      )}
      {hasGain && (
        <div className="text-[11px] mt-1 font-mono flex justify-between gap-3">
          <span className="text-ink-400">{t('card.gain')}</span>
          <span className={`private tabular-nums ${gainToneClass(a.gain)}`} data-testid="gain">
            {signedAmount(a.gain!, fmt)}
            {a.gainPct != null && ` (${formatGainPct(a.gainPct, numberLocale(i18n.language))})`}
          </span>
        </div>
      )}
      {a.type === 'investment' && onUpdateValue && (
        <button type="button" className="btn-sm mt-3" onClick={() => onUpdateValue(a)}>
          {t('card.updateValue')}
        </button>
      )}
    </>
  );
}
