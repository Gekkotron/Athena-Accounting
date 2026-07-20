import { useEffect } from 'react';
import { useTips } from '../contexts/TipsContext';
import { useTour } from '../contexts/TourContext';
import { tipIdFor, type PageId } from '../tips/tours';

export interface UseAutoStartTourOptions {
  requireData?: () => boolean;
}

// One effect per page mount. Fires startTour when every gate passes:
//   ready + !dismissed + no active tour + (requireData?() ?? true).
// Effect re-runs on every render (requireData may look at fresh
// React Query cache each render), but short-circuits once the tour is
// dismissed. A throwing predicate is treated as false — a crash in
// business logic should not block onboarding auto-start; the tour
// simply waits for a healthy render.
export function useAutoStartTour(pageId: PageId, opts?: UseAutoStartTourOptions): void {
  const { ready, isDismissed } = useTips();
  const { activePageId, startTour } = useTour();

  useEffect(() => {
    if (!ready) return;
    if (isDismissed(tipIdFor(pageId))) return;
    if (activePageId != null) return;
    let dataOk = true;
    if (opts?.requireData) {
      try { dataOk = opts.requireData(); }
      catch { dataOk = false; }
    }
    if (!dataOk) return;
    startTour(pageId);
  });
  // Intentionally no dep array: requireData is a closure over caller
  // state that we can't statically enumerate, and the guards above make
  // the effect body cheap on every render (returns early once dismissed
  // or when a tour is running).
}
