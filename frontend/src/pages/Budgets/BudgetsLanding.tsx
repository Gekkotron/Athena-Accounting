import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function BudgetsLanding(): JSX.Element {
  const { t } = useTranslation('budgets');
  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="display text-2xl text-ink-50">{t('landing.title')}</h1>
        <p className="text-sm text-ink-400 mt-1">{t('landing.subtitle')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <LandingTile
          to="/budgets/caps"
          title={t('landing.plafonds.title')}
          pitch={t('landing.plafonds.pitch')}
          cta={t('landing.plafonds.cta')}
        />
        <LandingTile
          to="/budgets/envelopes"
          title={t('landing.envelopes.title')}
          pitch={t('landing.envelopes.pitch')}
          cta={t('landing.envelopes.cta')}
        />
      </div>
    </div>
  );
}

function LandingTile(props: { to: string; title: string; pitch: string; cta: string }): JSX.Element {
  return (
    <Link
      to={props.to}
      className="surface p-6 flex flex-col gap-4 border border-ink-800/60 hover:border-ink-700 transition-colors"
    >
      <h2 className="display text-xl text-ink-50">{props.title}</h2>
      <p className="text-sm text-ink-300 flex-1">{props.pitch}</p>
      <span className="text-sm font-medium text-ink-100">{props.cta} →</span>
    </Link>
  );
}
