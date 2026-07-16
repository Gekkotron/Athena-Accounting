import { useTips } from '../contexts/TipsContext';
import { SECTION_TIPS, type TipId } from '../tips/content';

type SectionTipId = Exclude<TipId, 'welcome_tour'>;

// Small inline card shown once at the top of a main section, until the
// user dismisses it via the close button. Dismissal is persisted through
// TipsContext, so it will not reappear on future visits or reloads.
export function SectionTip({ id }: { id: SectionTipId }): JSX.Element | null {
  const { ready, isDismissed, dismiss } = useTips();

  if (!ready || isDismissed(id)) return null;

  const { title, body } = SECTION_TIPS[id];

  return (
    <section
      aria-labelledby={`tip-${id}`}
      className="surface-soft mb-4 flex items-start justify-between gap-3 px-4 py-3"
    >
      <div>
        <h3 id={`tip-${id}`} className="text-sm font-medium text-ink-100">
          {title}
        </h3>
        <p className="text-sm text-ink-400 mt-1 leading-relaxed">{body}</p>
      </div>
      <button
        type="button"
        aria-label="Masquer ce conseil"
        onClick={() => {
          dismiss(id).catch(() => {
            // Optimistic update already applied; TipsContext rolls back on
            // failure and the tip simply reappears on the next render.
          });
        }}
        className="btn-ghost !min-h-0 shrink-0 !px-2 !py-1 text-base leading-none"
      >
        ×
      </button>
    </section>
  );
}
