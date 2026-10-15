import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Element id → i18n key under dashboard.sectionNav.items. The `sectionId`
// field matches the Settings → Dashboard checkbox ids so we can filter the
// pill set with the same `hidden` Set that gates the sections themselves.
// Ordered top-to-bottom so the IntersectionObserver can pick the highest
// visible section as the current one without a separate sort step.
const ITEMS = [
  { id: 'dash-balance',   labelKey: 'balance',   sectionId: 'balance'   },
  { id: 'dash-insights',  labelKey: 'insights',  sectionId: 'insights'  },
  { id: 'dash-budget',    labelKey: 'budget',    sectionId: 'budget'    },
  { id: 'dash-evolution', labelKey: 'evolution', sectionId: 'evolution' },
  { id: 'dash-sankey',    labelKey: 'sankey',    sectionId: 'sankey'    },
] as const;

// Sticky anchor-pill nav rendered just under the Dashboard Hero. On a 9-
// section page, it turns scrolling into clicking. Pills reuse the .badge
// primitive; the pill matching the section currently crossing the viewport
// is marked aria-current="true" (IntersectionObserver — jsdom lacks it, so
// tests either stub it or skip the active-tracking behavior).
export function DashboardSectionNav({ hidden }: { hidden?: ReadonlySet<string> } = {}): JSX.Element {
  const { t } = useTranslation('dashboard');
  // Visible items for this render. Falls back to the full list when no
  // filter is passed so the component stays usable without the hidden
  // prop (e.g. in isolation tests). Memoized by the hidden-set identity.
  const items = useMemo(
    () => (hidden ? ITEMS.filter((i) => !hidden.has(i.sectionId)) : ITEMS),
    [hidden],
  );
  const firstId = items[0]?.id ?? ITEMS[0].id;
  const [activeId, setActiveId] = useState<string>(firstId);
  const visibleRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    const observed: Element[] = [];
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observed.push(el);
    }
    if (observed.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visibleRef.current.add(entry.target.id);
          else visibleRef.current.delete(entry.target.id);
        }
        // The items order matches top-to-bottom on the page, so the first
        // visible one is the highest in the viewport — exactly what the
        // user expects "I'm on this section" to mean.
        const first = items.find((i) => visibleRef.current.has(i.id));
        if (first) setActiveId(first.id);
      },
      // Shrinks the trigger zone: a section only becomes active once its
      // top crosses roughly the sticky nav line, not the moment any pixel
      // of it enters the viewport.
      { rootMargin: '-80px 0px -40% 0px', threshold: 0 },
    );
    observed.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveId(id);
  };

  return (
    <nav
      aria-label={t('sectionNav.ariaLabel')}
      className="md:sticky md:top-4 md:z-10 -mx-4 md:mx-0 px-4 md:px-3 py-2 overflow-x-auto md:overflow-visible md:rounded-xl md:border md:border-ink-800/70 md:bg-ink-950/80 md:backdrop-blur"
    >
      <ul className="flex items-center gap-2 whitespace-nowrap">
        {items.map((item) => {
          const isActive = activeId === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => handleClick(item.id)}
                aria-current={isActive ? 'true' : undefined}
                className={
                  isActive
                    ? 'badge border-sage-800/60 bg-sage-900/40 text-sage-200 cursor-pointer'
                    : 'badge cursor-pointer hover:text-ink-100 hover:border-ink-700'
                }
              >
                {t(`sectionNav.items.${item.labelKey}`)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
