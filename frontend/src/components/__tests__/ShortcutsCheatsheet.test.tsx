import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutsProvider, useShortcuts } from '../ShortcutsCheatsheet';
import { pinLocale } from '../../test/i18n';

pinLocale('common');

function Trigger() {
  const { open } = useShortcuts();
  return (
    <button data-testid="trigger" onClick={open}>
      open
    </button>
  );
}

function mount() {
  return render(
    <ShortcutsProvider>
      <Trigger />
      <input data-testid="search" />
    </ShortcutsProvider>,
  );
}

describe('ShortcutsCheatsheet', () => {
  it('opens on the global `?` key and shows the Transactions group', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    // Transactions shortcut row is rendered.
    expect(screen.getByText(/Descendre le curseur/i)).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    mount();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on backdrop click', () => {
    mount();
    fireEvent.keyDown(window, { key: '?' });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open on `?` while typing in an input', () => {
    mount();
    const input = screen.getByTestId('search');
    input.focus();
    fireEvent.keyDown(input, { key: '?', target: input });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens via useShortcuts().open() exposed by the provider', () => {
    mount();
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
