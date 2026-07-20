import { useTranslation } from 'react-i18next';
import { useTips } from '../contexts/TipsContext';
import { useTour } from '../contexts/TourContext';
import { tipIdFor, type PageId } from '../tips/tours';

// Small (?) button that reappears next to a page's title once the page's
// tour has been dismissed, letting the user replay it on demand. Replay
// bypasses the requireData gate: an explicit user request always shows
// the tour (steps whose anchors aren't mounted fall through the 2s
// missing-anchor fallback in TourContext).
export function TourReplayIcon({ pageId }: { pageId: PageId }): JSX.Element | null {
  const { ready, isDismissed, undismiss } = useTips();
  const { startTour } = useTour();
  const { t } = useTranslation('tips');

  const id = tipIdFor(pageId);
  if (!ready || !isDismissed(id)) return null;

  return (
    <button
      type="button"
      aria-label={t('tour.replayIconAriaLabel')}
      onClick={() => {
        undismiss(id).catch(() => {
          // Optimistic update handled by TipsContext; rollback happens
          // there. The tour has already started, so the user got their
          // replay — the icon may reappear on next reload, acceptable.
        });
        startTour(pageId);
      }}
      className="btn-ghost !min-h-0 !px-2 !py-1 text-xs leading-none text-ink-400 hover:text-ink-100"
    >
      ?
    </button>
  );
}
