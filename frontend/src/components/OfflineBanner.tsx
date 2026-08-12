import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

// Rendered at the top of the layout whenever the browser reports itself
// offline. The demo build runs entirely from the JavaScript bundle with no
// server round-trips, so `navigator.onLine === false` there is not an
// actionable warning — suppress the banner in that build.
const IS_DEMO = import.meta.env.VITE_DEMO === '1';

export function OfflineBanner(): JSX.Element | null {
  const { t } = useTranslation('layout');
  const online = useOnlineStatus();
  if (IS_DEMO || online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 px-4 py-1.5 text-xs bg-clay-900/70 border-b border-clay-800/70 text-clay-100"
    >
      <span className="text-clay-300" aria-hidden="true">●</span>
      <span>{t('offline.message')}</span>
    </div>
  );
}
