import type { ReactElement } from 'react';
import { TipsProvider } from '../contexts/TipsContext';
import { TourProvider } from '../contexts/TourContext';

// Wraps a page element in <TipsProvider><TourProvider> for tests that render
// a page which reads tip/tour state via useTips()/useTour() (e.g. via
// <TourReplayIcon>, useAutoStartTour, useTourAnchor). TipsProvider's own
// hydration fetch to /api/tips/dismissed fails closed when a test's
// api()/fetch mock doesn't recognize the route, so no additional stubbing
// is required beyond this wrapper.
//
// TourProvider reads useLocation() internally, so it must be mounted inside
// a Router — every call site is expected to already wrap itself in a
// <MemoryRouter> (some pages read useSearchParams()/useLocation() directly
// and rely on that same outer router with its own `initialEntries`, so this
// helper deliberately does not nest another Router of its own).
export function withTips(children: ReactElement): ReactElement {
  return (
    <TipsProvider>
      <TourProvider>{children}</TourProvider>
    </TipsProvider>
  );
}
