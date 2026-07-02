import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Th } from '../Th';
import type { Filters } from '../index';

const baseFilters: Filters = { sort: 'amount', order: 'desc' };

describe('Th', () => {
  it('renders its label', () => {
    render(
      <table>
        <thead>
          <tr>
            <Th sort="date" filters={baseFilters} setFilters={() => {}} setOffset={() => {}}>
              Date
            </Th>
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByText('Date')).toBeInTheDocument();
  });

  it('resets offset and sets sort/order (desc) when clicking a new field', async () => {
    const inactiveFilters: Filters = { sort: 'date', order: 'desc' };
    const setFilters = vi.fn();
    const setOffset = vi.fn();
    const user = userEvent.setup();
    render(
      <table>
        <thead>
          <tr>
            <Th sort="amount" filters={inactiveFilters} setFilters={setFilters} setOffset={setOffset}>
              Montant
            </Th>
          </tr>
        </thead>
      </table>,
    );

    await user.click(screen.getByRole('columnheader'));

    expect(setOffset).toHaveBeenCalledWith(0);
    expect(setFilters).toHaveBeenCalledTimes(1);
    const updater = setFilters.mock.calls[0]![0] as (f: Filters) => Filters;
    expect(updater(inactiveFilters)).toEqual({ sort: 'amount', order: 'desc' });
  });

  it('toggles order from desc to asc when clicking the already-active field', async () => {
    const activeFilters: Filters = { sort: 'date', order: 'desc' };
    const setFilters = vi.fn();
    const user = userEvent.setup();
    render(
      <table>
        <thead>
          <tr>
            <Th sort="date" filters={activeFilters} setFilters={setFilters} setOffset={() => {}}>
              Date
            </Th>
          </tr>
        </thead>
      </table>,
    );

    await user.click(screen.getByRole('columnheader'));

    const updater = setFilters.mock.calls[0]![0] as (f: Filters) => Filters;
    expect(updater(activeFilters)).toEqual({ sort: 'date', order: 'asc' });
  });

  it('renders a sort indicator (arrow) when the field is the active sort', () => {
    render(
      <table>
        <thead>
          <tr>
            <Th sort="date" filters={{ sort: 'date', order: 'desc' }} setFilters={() => {}} setOffset={() => {}}>
              Date
            </Th>
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'Date ↓')).toBeInTheDocument();
  });

  it('does not render a sort indicator when the field is not the active sort', () => {
    render(
      <table>
        <thead>
          <tr>
            <Th sort="amount" filters={{ sort: 'date', order: 'desc' }} setFilters={() => {}} setOffset={() => {}}>
              Montant
            </Th>
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByText('Montant')).toBeInTheDocument();
    expect(screen.queryByText(/Montant\s*[↑↓]/)).not.toBeInTheDocument();
  });
});
