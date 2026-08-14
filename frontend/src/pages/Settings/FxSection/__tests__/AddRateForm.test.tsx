import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddRateForm } from '../AddRateForm';
import { pinLocale } from '../../../../test/i18n';

// AddRateForm renders French labels by default (the app's current UI
// language). Preload the 'settings' namespace for both locales so
// `useTranslation` never suspends mid-render, then pin the active language
// to French so the French-literal assertions below keep matching real
// rendered text.
pinLocale('settings');

describe('AddRateForm', () => {
  it('accepts French decimal comma in the rate input', async () => {
    const onSubmit = vi.fn();
    render(<AddRateForm currencies={['EUR', 'USD']} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^de$/i), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText(/^vers$/i), { target: { value: 'EUR' } });
    fireEvent.change(screen.getByLabelText(/effectif/i), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText(/taux/i), { target: { value: '0,9' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      from: 'USD', to: 'EUR', effectiveFrom: '2026-01-01', rate: '0.9',
    });
  });

  it('renders the rate input as type="text" (not "number") to accept French decimals', () => {
    const onSubmit = vi.fn();
    render(<AddRateForm currencies={['EUR', 'USD']} onSubmit={onSubmit} />);
    expect(screen.getByLabelText(/taux/i)).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/taux/i)).toHaveAttribute('inputMode', 'decimal');
  });

  it('surfaces a duplicate error passed as a prop', () => {
    const onSubmit = vi.fn();
    render(<AddRateForm currencies={['EUR', 'USD']} onSubmit={onSubmit} error="duplicate" />);
    expect(screen.getByText(/existe déjà/i)).toBeInTheDocument();
  });

  it('rejects submit when from and to currencies are the same', () => {
    const onSubmit = vi.fn();
    render(<AddRateForm currencies={['EUR', 'USD']} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^de$/i), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText(/^vers$/i), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText(/effectif/i), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText(/taux/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/doivent être différentes/i)).toBeInTheDocument();
  });

  it('rejects submit when the rate cannot be parsed', () => {
    const onSubmit = vi.fn();
    render(<AddRateForm currencies={['EUR', 'USD']} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^de$/i), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText(/^vers$/i), { target: { value: 'EUR' } });
    fireEvent.change(screen.getByLabelText(/effectif/i), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText(/taux/i), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /ajouter/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/taux invalide/i)).toBeInTheDocument();
  });
});
