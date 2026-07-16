import { useTips } from '../contexts/TipsContext';
import type { TipId } from '../tips/content';

type SectionTipId = Exclude<TipId, 'welcome_tour'>;

// Small (?) button that reappears next to a section's title once its
// SectionTip has been dismissed, letting the user replay it on demand.
export function SectionTipHelpIcon({ id }: { id: SectionTipId }): JSX.Element | null {
  const { ready, isDismissed, undismiss } = useTips();

  if (!ready || !isDismissed(id)) return null;

  return (
    <button
      type="button"
      aria-label="Réafficher le conseil de cette section"
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
