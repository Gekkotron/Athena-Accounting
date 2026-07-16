import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnvelopeRow } from '../EnvelopeRow';

const row = {
  categoryId: 1, categoryName: 'Alimentation',
  balancePriorMonth: '80.00', assignment: '450.00',
  spend: '510.00', balance: '20.00',
  target: null, overspendPolicy: 'rollover_negative' as const,
  overspent: false, absorbedByPool: '0.00', monthsToTarget: null,
};

describe('EnvelopeRow', () => {
  it('renders name, prev, spend, balance', () => {
    render(<EnvelopeRow row={row} onReallocateClick={vi.fn()} onSettingsClick={vi.fn()} assignmentSlot={<span>slot</span>} />);
    expect(screen.getByText('Alimentation')).toBeInTheDocument();
    expect(screen.getByText('80,00 €')).toBeInTheDocument();
    expect(screen.getByText('510,00 €')).toBeInTheDocument();
    expect(screen.getByText('20,00 €')).toBeInTheDocument();
  });

  it('shows absorbé chip when overspent under reallocate_manual', () => {
    render(<EnvelopeRow
      row={{ ...row, overspendPolicy: 'reallocate_manual', overspent: true, balance: '0.00', absorbedByPool: '65.00' }}
      onReallocateClick={vi.fn()} onSettingsClick={vi.fn()} assignmentSlot={<span />}
    />);
    expect(screen.getByText(/absorbé/i)).toBeInTheDocument();
  });
});
