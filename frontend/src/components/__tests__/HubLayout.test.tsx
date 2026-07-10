import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HubLayout, type HubTab } from '../HubLayout';

const tabs: HubTab[] = [
  { to: '/hub/a', label: 'Alpha' },
  { to: '/hub/b', label: 'Bravo' },
];

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/hub" element={<HubLayout title="Hub" tabs={tabs} />}>
          <Route path="a" element={<div>content-a</div>} />
          <Route path="b" element={<div>content-b</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('HubLayout', () => {
  it('renders the title and every tab', () => {
    renderAt('/hub/a');
    expect(screen.getByRole('heading', { name: 'Hub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/hub/a');
    expect(screen.getByRole('link', { name: 'Bravo' })).toHaveAttribute('href', '/hub/b');
  });

  it('renders the child route content via Outlet', () => {
    renderAt('/hub/a');
    expect(screen.getByText('content-a')).toBeInTheDocument();
    renderAt('/hub/b');
    expect(screen.getByText('content-b')).toBeInTheDocument();
  });

  it('marks the active tab with aria-current="page"', () => {
    renderAt('/hub/b');
    const alpha = screen.getByRole('link', { name: 'Alpha' });
    const bravo = screen.getByRole('link', { name: 'Bravo' });
    expect(bravo).toHaveAttribute('aria-current', 'page');
    expect(alpha).not.toHaveAttribute('aria-current', 'page');
  });
});
