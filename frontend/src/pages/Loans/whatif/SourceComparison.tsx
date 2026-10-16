import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getLoan, type LoanSummary } from '../../../api/loans';
import { ComparisonTable } from './ComparisonTable';

interface Props {
  sourceId: number;
  summary: LoanSummary; // the simulation's own summary
  currency: string;
}

// A saved simulation opened in the drawer, compared with the real loan it
// came from. Renders nothing while loading or if the source is unreadable.
export function SourceComparison({ sourceId, summary, currency }: Props) {
  const { t } = useTranslation('loans');
  const q = useQuery({ queryKey: ['loans', 'detail', sourceId], queryFn: () => getLoan(sourceId), retry: false });
  const src = q.data;
  if (!src?.summary) return null;
  return (
    <section className="surface-soft p-3">
      <h3 className="label mb-2">{t('drawer.comparedWith', { name: src.loan.name })}</h3>
      <ComparisonTable base={src.summary} next={summary} currency={currency}
        baseLabel={src.loan.name} nextLabel={t('whatIf.scenario')} />
    </section>
  );
}
