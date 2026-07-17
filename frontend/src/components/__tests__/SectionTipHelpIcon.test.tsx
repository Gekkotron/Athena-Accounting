import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TipsProvider } from '../../contexts/TipsContext';
import { SectionTipHelpIcon } from '../SectionTipHelpIcon';
import i18n from '../../i18n';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeAll(async () => {
  await i18n.changeLanguage('fr');
  await i18n.loadNamespaces(['tips']);
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe('<SectionTipHelpIcon />', () => {
  it('renders nothing when the section tip is NOT dismissed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, text: async () => JSON.stringify({ dismissed: {} }),
    });
    render(
      <TipsProvider>
        <SectionTipHelpIcon id="section:budgets" />
      </TipsProvider>,
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a button when the section tip IS dismissed and calls undismiss on click', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true, status: 200,
        text: async () => JSON.stringify({ dismissed: { 'section:budgets': 'x' } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' });
    render(
      <TipsProvider>
        <SectionTipHelpIcon id="section:budgets" />
      </TipsProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/tips/undismiss',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
