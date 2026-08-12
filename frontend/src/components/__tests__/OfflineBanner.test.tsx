import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { OfflineBanner } from '../OfflineBanner';
import { pinLocale } from '../../test/i18n';

pinLocale('layout');

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('OfflineBanner', () => {
  afterEach(() => {
    setNavigatorOnline(true);
  });

  it('renders nothing while the browser is online', () => {
    setNavigatorOnline(true);
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a role=status banner with the localized message when offline', () => {
    setNavigatorOnline(false);
    render(<OfflineBanner />);
    const banner = screen.getByRole('status');
    // The default test language is French (see pinLocale).
    expect(banner).toHaveTextContent('hors ligne');
    // Assertive would over-announce a persistent state; polite is the right
    // live-region politeness for an ambient banner.
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('reacts live to the window offline/online events', () => {
    setNavigatorOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
