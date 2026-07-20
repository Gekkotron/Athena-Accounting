import { useCallback } from 'react';
import { useTour } from '../contexts/TourContext';
import type { AnchorId } from '../tips/tours';

// Ref-callback hook: target elements attach it via <div ref={useTourAnchor('foo:bar')} />
// to expose their DOM node to the running tour. On mount, calls
// registerAnchor(id, node); on unmount, calls registerAnchor(id, null).
//
// If the same AnchorId is used from two mount points at once
// (e.g. `accounts:add-button` in the header and in the empty-state CTA),
// last-register-wins in TourContext — the empty state, being
// conditionally mounted, effectively takes over when it is visible.
export function useTourAnchor(id: AnchorId): (el: HTMLElement | null) => void {
  const { registerAnchor } = useTour();
  return useCallback((el: HTMLElement | null) => {
    registerAnchor(id, el);
  }, [id, registerAnchor]);
}
