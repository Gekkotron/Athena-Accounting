import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { PrivacyProvider, usePrivacy } from '../PrivacyContext';

function Probe() {
  const p = usePrivacy();
  return (
    <div>
      <span data-testid="hidden">{String(p.hidden)}</span>
      <button onClick={p.toggle}>toggle</button>
      <button onClick={p.reveal}>reveal</button>
      <button onClick={p.hideNow}>hide</button>
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.classList.remove('privacy-on');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PrivacyContext', () => {
  it('starts unhidden and toggles the privacy-on class on <html>', () => {
    render(<PrivacyProvider><Probe /></PrivacyProvider>);
    expect(screen.getByTestId('hidden').textContent).toBe('false');
    expect(document.documentElement.classList.contains('privacy-on')).toBe(false);

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('hidden').textContent).toBe('true');
    expect(document.documentElement.classList.contains('privacy-on')).toBe(true);
  });

  it('hideNow() sets hidden=true, reveal() clears it', () => {
    render(<PrivacyProvider><Probe /></PrivacyProvider>);
    fireEvent.click(screen.getByText('hide'));
    expect(screen.getByTestId('hidden').textContent).toBe('true');
    fireEvent.click(screen.getByText('reveal'));
    expect(screen.getByTestId('hidden').textContent).toBe('false');
  });

  it('auto-hides after 5 minutes of inactivity', () => {
    render(<PrivacyProvider><Probe /></PrivacyProvider>);
    expect(screen.getByTestId('hidden').textContent).toBe('false');
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(screen.getByTestId('hidden').textContent).toBe('true');
  });

  it('resets the idle timer on user activity', () => {
    render(<PrivacyProvider><Probe /></PrivacyProvider>);
    // 4 minutes of idle time.
    act(() => { vi.advanceTimersByTime(4 * 60 * 1000); });
    expect(screen.getByTestId('hidden').textContent).toBe('false');
    // User activity resets the countdown.
    act(() => { window.dispatchEvent(new MouseEvent('mousemove')); });
    act(() => { vi.advanceTimersByTime(4 * 60 * 1000); });
    // Still under 5 min since last activity — not hidden yet.
    expect(screen.getByTestId('hidden').textContent).toBe('false');
    // Cross the threshold.
    act(() => { vi.advanceTimersByTime(2 * 60 * 1000); });
    expect(screen.getByTestId('hidden').textContent).toBe('true');
  });

  it('throws when usePrivacy is called outside the provider', () => {
    // Silence the expected React error boundary log.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/usePrivacy/);
    spy.mockRestore();
  });
});
