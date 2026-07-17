import { useTranslation } from 'react-i18next';
import { useTips } from '../contexts/TipsContext';
import type { SectionTipId } from '../tips/content';

// Small (?) button that reappears next to a section's title once its
// SectionTip has been dismissed, letting the user replay it on demand.
export function SectionTipHelpIcon({ id }: { id: SectionTipId }): JSX.Element | null {
  const { ready, isDismissed, undismiss } = useTips();
  const { t } = useTranslation('tips');

  if (!ready || !isDismissed(id)) return null;

  return (
    <button
      type="button"
      aria-label={t('sectionTipHelpIcon.showAriaLabel')}
      onClick={() => {
        undismiss(id).catch(() => {
          // Optimistic update already applied; TipsContext rolls back on
          // failure and the button simply stays visible.
        });
      }}
      className="btn-ghost !min-h-0 !px-2 !py-1 text-xs leading-none text-ink-400 hover:text-ink-100"
    >
      ?
    </button>
  );
}
