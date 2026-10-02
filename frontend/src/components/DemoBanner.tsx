import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { reset as resetDemoStore } from '../api/demo/store';

// Banner shown at the top of every page in the browser-only demo
// build. Only renders when VITE_DEMO='1' — the check is compile-time
// so this component tree-shakes out of the production bundle.
const IS_DEMO = import.meta.env.VITE_DEMO === '1';

export function DemoBanner() {
  const qc = useQueryClient();
  const [flash, setFlash] = useState(false);
  const { t } = useTranslation('layout');

  if (!IS_DEMO) return null;

  const onReset = () => {
    resetDemoStore();
    // Force the whole app to re-fetch against the fresh seed.
    qc.invalidateQueries();
    setFlash(true);
    setTimeout(() => setFlash(false), 1600);
  };

  return (
    <div
      role="region"
      aria-label={t('demoBanner.aria')}
      className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-1.5 text-xs bg-sage-900/40 border-b border-sage-800/60 text-sage-100"
    >
      <span className="truncate">
        <strong className="font-semibold text-sage-50">{t('demoBanner.prefix')}</strong>{' '}
        {t('demoBanner.message')}
      </span>
      <div className="flex items-center gap-3 shrink-0">
        {flash && <span className="text-sage-200">{t('demoBanner.resetDone')}</span>}
        <button
          onClick={onReset}
          className="rounded border border-sage-700/70 bg-sage-900/40 hover:bg-sage-800/60 px-2 py-0.5 text-sage-50 transition-colors"
        >
          {t('demoBanner.reset')}
        </button>
      </div>
    </div>
  );
}
