import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardSectionNav } from '../DashboardSectionNav';
import { pinLocale } from '../../../test/i18n';

pinLocale('dashboard');

// jsdom has neither IntersectionObserver nor Element.scrollIntoView. The
// component gracefully no-ops the observer when it's undefined — we only
// need to stub scrollIntoView so click interactions don't throw.
let scrollSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  scrollSpy = vi.fn();
  Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;
  // Mount sentinel targets so the click handler finds them via
  // getElementById. Without these, scrollIntoView would be a no-op and the
  // aria-current update wouldn't fire.
  for (const id of ['dash-balance', 'dash-insights', 'dash-budget', 'dash-evolution', 'dash-sankey']) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
});
afterEach(() => {
  document.querySelectorAll('[id^="dash-"]').forEach((el) => el.remove());
});

it('renders five section-nav pills', () => {
  render(<DashboardSectionNav />);
  expect(screen.getByRole('button', { name: 'Solde' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Insights' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Budget' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Évolution' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Flux' })).toBeInTheDocument();
});

it('marks the first pill as aria-current by default', () => {
  render(<DashboardSectionNav />);
  expect(screen.getByRole('button', { name: 'Solde' })).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('button', { name: 'Insights' })).not.toHaveAttribute('aria-current');
});

it('scrolls to the matching section and updates aria-current when a pill is clicked', async () => {
  render(<DashboardSectionNav />);
  const u = userEvent.setup();
  await u.click(screen.getByRole('button', { name: 'Insights' }));

  expect(scrollSpy).toHaveBeenCalledTimes(1);
  const call = scrollSpy.mock.instances[0] as unknown as HTMLElement;
  expect(call.id).toBe('dash-insights');
  expect(screen.getByRole('button', { name: 'Insights' })).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('button', { name: 'Solde' })).not.toHaveAttribute('aria-current');
});

it('filters pills using the `hidden` set', () => {
  render(<DashboardSectionNav hidden={new Set(['sankey', 'budget'])} />);
  expect(screen.getByRole('button', { name: 'Solde' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Insights' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Évolution' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Budget' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Flux' })).toBeNull();
});
