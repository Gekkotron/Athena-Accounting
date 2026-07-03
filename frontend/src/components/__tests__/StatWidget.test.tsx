import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatWidget } from '../StatWidget';

describe('StatWidget', () => {
  it('renders label + formatted value + hint', () => {
    render(<StatWidget label="Dépense moyenne" value={-1234.56} hint="sur 12 mois" />);
    expect(screen.getByText('Dépense moyenne')).toBeInTheDocument();
    // formatAmount emits the FR locale — the raw digit sequence should be present.
    expect(screen.getByText(/1[  ]?234/)).toBeInTheDocument();
    expect(screen.getByText('sur 12 mois')).toBeInTheDocument();
  });

  it('applies auto tone: negative amounts get the clay class', () => {
    const { container } = render(<StatWidget label="x" value={-100} />);
    const num = container.querySelector('.display');
    expect(num?.className).toMatch(/clay/);
  });

  it('applies auto tone: positive amounts get the sage class', () => {
    const { container } = render(<StatWidget label="x" value={100} />);
    const num = container.querySelector('.display');
    expect(num?.className).toMatch(/sage/);
  });

  it('honors an explicit tone override', () => {
    const { container } = render(<StatWidget label="x" value={100} tone="amber" />);
    const num = container.querySelector('.display');
    expect(num?.className).toMatch(/amber/);
    expect(num?.className).not.toMatch(/sage/);
  });

  it('wraps the amount in .private by default', () => {
    const { container } = render(<StatWidget label="x" value={100} />);
    expect(container.querySelector('.private')).toBeTruthy();
  });

  it('omits .private when privateAmount=false', () => {
    const { container } = render(<StatWidget label="x" value={100} privateAmount={false} />);
    expect(container.querySelector('.private')).toBeNull();
  });

  it('renders the icon and footer when provided', () => {
    render(
      <StatWidget
        label="x" value={100}
        icon={<span data-testid="icon">🪙</span>}
        footer={<span>+5% vs le mois dernier</span>}
      />,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText(/5%.*mois dernier/)).toBeInTheDocument();
  });
});
