import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

type Props = { unmapped: Array<{ currency: string }>; className?: string };

// Amber warning strip listing currencies a manual-FX consolidated block
// couldn't convert (no applicable rate) — shared by the Dashboard's
// ConsolidatedTotalCard and the Budgets page's ConsolidatedSummary so the
// two stay visually identical without copy-pasted JSX.
export function FxUnmappedWarning({ unmapped, className }: Props): JSX.Element | null {
  const { t } = useTranslation('common');
  if (unmapped.length === 0) return null;
  return (
    <div className={`rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 ${className ?? ''}`}>
      <div className="text-xs text-amber-300/90">{t('fx.unmappedWarning')}</div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {unmapped.map((c) => (
          <li key={c.currency} className="flex items-center gap-1.5 text-sm">
            <span className="font-mono">{c.currency}</span>
            <Link to="/settings#fx" className="text-sky-300 hover:text-sky-200 underline underline-offset-2">
              {t('fx.addRate')}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
