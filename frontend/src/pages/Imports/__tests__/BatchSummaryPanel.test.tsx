import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BatchSummaryPanel, type BatchState } from '../BatchSummaryPanel';

const doneWithErrors: BatchState = {
  phase: 'done', imported: 1, inserted: 3, skipped: 0, needsTemplate: [],
  errors: [
    { file: new File(['x'], 'a.csv'), message: 'boom' },
    { file: new File(['x'], 'b.csv'), message: 'kaboom' },
  ],
};

describe('BatchSummaryPanel', () => {
  it('renders "N en erreur" and one Réessayer button per error', async () => {
    const user = userEvent.setup();
    const onRetryOne = vi.fn();
    render(<BatchSummaryPanel batch={doneWithErrors} onRetryOne={onRetryOne} onRetryAll={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByText(/2 en erreur/));
    const retryButtons = screen.getAllByRole('button', { name: /Réessayer a\.csv|Réessayer b\.csv/ });
    expect(retryButtons).toHaveLength(2);
    await user.click(retryButtons[0]!);
    expect(onRetryOne).toHaveBeenCalledWith(0);
  });

  it('shows "Réessayer tout" only when 2+ errors and calls onRetryAll', async () => {
    const user = userEvent.setup();
    const onRetryAll = vi.fn();
    render(<BatchSummaryPanel batch={doneWithErrors} onRetryOne={vi.fn()} onRetryAll={onRetryAll} onClose={vi.fn()} />);
    await user.click(screen.getByText(/2 en erreur/));
    await user.click(screen.getByRole('button', { name: 'Réessayer tout' }));
    expect(onRetryAll).toHaveBeenCalledTimes(1);
  });

  it('does NOT show "Réessayer tout" when exactly one error remains', async () => {
    const user = userEvent.setup();
    const oneError: BatchState = {
      ...doneWithErrors,
      errors: [{ file: new File(['x'], 'a.csv'), message: 'boom' }],
    };
    render(<BatchSummaryPanel batch={oneError} onRetryOne={vi.fn()} onRetryAll={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByText(/1 en erreur/));
    expect(screen.queryByRole('button', { name: 'Réessayer tout' })).not.toBeInTheDocument();
  });

  it('renders nothing for a single-file running phase', () => {
    const { container } = render(<BatchSummaryPanel
      batch={{ phase: 'running', current: 1, total: 1, currentName: 'x.csv' }}
      onRetryOne={vi.fn()} onRetryAll={vi.fn()} onClose={vi.fn()}
    />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders running progress for a batch of 2+', () => {
    render(<BatchSummaryPanel
      batch={{ phase: 'running', current: 1, total: 3, currentName: 'x.csv' }}
      onRetryOne={vi.fn()} onRetryAll={vi.fn()} onClose={vi.fn()}
    />);
    expect(screen.getByText(/Traitement/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
  });

  it('Fermer calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BatchSummaryPanel batch={doneWithErrors} onRetryOne={vi.fn()} onRetryAll={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
