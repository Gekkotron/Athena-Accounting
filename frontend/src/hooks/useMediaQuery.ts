import { useSyncExternalStore } from 'react';

// SSR-safe matchMedia hook via useSyncExternalStore. Returns `false` on the
// server / before hydration and in test environments (jsdom has no
// matchMedia), so a `md:hidden` mobile view mounts and then swaps on the
// client — same behavior as Tailwind's breakpoint utilities, but readable
// from JS to switch between DOM shapes (table vs. card list).
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    () => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
      return window.matchMedia(query).matches;
    },
    () => false,
  );
}
