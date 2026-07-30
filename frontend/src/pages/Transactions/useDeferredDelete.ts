import { useEffect, useMemo, useRef, useState } from 'react';

export const UNDO_WINDOW_MS = 5000;

export interface PendingDelete {
  ids: number[];
  kind: 'single' | 'bulk';
  execute: () => void;
}

// Client-side deferred deletion: the DELETE call fires only after the undo
// window expires, so "Annuler" can cancel it without any server round-trip.
// The rows are hidden (hiddenIds) in the meantime so the list reads as if
// the deletion already happened.
export function useDeferredDelete() {
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirror of `pending` so the unmount flush can read it without the
  // effect depending on state — a state-dependent cleanup would fire the
  // delete on undo() as well.
  const pendingRef = useRef<PendingDelete | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const flush = () => {
    clearTimer();
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (p) p.execute();
  };

  const begin = (ids: number[], kind: PendingDelete['kind'], execute: () => void) => {
    // A second delete while one is pending commits the first immediately —
    // only one undo window at a time.
    flush();
    const p: PendingDelete = { ids, kind, execute };
    pendingRef.current = p;
    setPending(p);
    timerRef.current = setTimeout(flush, UNDO_WINDOW_MS);
  };

  const undo = () => {
    clearTimer();
    pendingRef.current = null;
    setPending(null);
  };

  // Navigating away must not silently drop a deletion the user watched
  // happen — flush it on unmount instead of losing it.
  useEffect(
    () => () => {
      clearTimer();
      const p = pendingRef.current;
      pendingRef.current = null;
      if (p) p.execute();
    },
    [],
  );

  const hiddenIds = useMemo(() => new Set(pending?.ids ?? []), [pending]);

  return { pending, hiddenIds, begin, undo };
}
