import type { ReactElement } from 'react';
import { TipsProvider } from '../contexts/TipsContext';

// Wraps a page element in <TipsProvider> for tests that render a page which
// mounts <SectionTip>/<SectionTipHelpIcon>. Those components call useTips()
// unconditionally and throw when rendered outside a provider. TipsProvider's
// own hydration fetch to /api/tips/dismissed fails closed when a test's
// api()/fetch mock doesn't recognize the route, so no additional stubbing
// is required beyond this wrapper.
export function withTips(children: ReactElement): ReactElement {
  return <TipsProvider>{children}</TipsProvider>;
}
