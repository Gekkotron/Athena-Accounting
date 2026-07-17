import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountForm } from '../AccountForm';
import { pinLocale } from '../../../test/i18n';

// AccountForm uses both the 'accounts' namespace (labels, type options) and
// 'common' (Save/Cancel). Preload both for both locales, pinned to French,
// so `useTranslation` never suspends and the existing French-literal
// assertions below keep matching real rendered text.
pinLocale('accounts');

// The form fields render a plain `<label>` sibling next to the `<input>`/
// `<select>` without a `for`/`id` association, so `getByLabelText` cannot
// find them (same limitation documented in Accounts.test.tsx). This helper
// locates the input by walking from the visible label text to its
// containing field wrapper.
function fieldFor(labelText: RegExp) {
  const label = screen.getByText(labelText, { selector: 'label' });
  const wrapper = label.parentElement as HTMLElement;
  const control = wrapper.querySelector('input, select');
  if (!control) throw new Error(`no input/select next to label matching ${labelText}`);
  return control as HTMLElement;
}

describe('AccountForm', () => {
  it('create mode: types values and submits them', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AccountForm mode="create" onSubmit={onSubmit} />);
    await user.type(fieldFor(/^nom$/i), 'Livret');
    // jsdom's `type="date"` input doesn't accept a typed "YYYY-MM-DD" string
    // via userEvent keystrokes, so set the value directly and fire the
    // change event the component listens for.
    fireEvent.change(fieldFor(/date d.ouverture/i), { target: { value: '2026-05-01' } });
    await user.click(screen.getByRole('button', { name: /créer le compte/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Livret',
      openingDate: '2026-05-01',
    }));
  });

  it('edit mode: pre-fills from initial prop', () => {
    render(<AccountForm
      mode="edit"
      initial={{ name: 'Existing', type: 'savings', currency: 'EUR',
        openingBalance: '100.00', openingDate: '2025-01-01' }}
      onSubmit={() => {}}
    />);
    expect(screen.getByDisplayValue('Existing')).toBeInTheDocument();
    // `getByDisplayValue` on a <select> matches the selected option's text
    // content ("Épargne"), not the underlying value ("savings").
    expect(screen.getByDisplayValue('Épargne')).toBeInTheDocument();
    expect(screen.getByDisplayValue('100.00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2025-01-01')).toBeInTheDocument();
  });

  it('create submit does not fire onSubmit while required fields are empty', async () => {
    // The submit button's `disabled` prop only tracks `submitting`, not
    // field emptiness — so this asserts the actual guard: native HTML
    // `required` constraint validation blocks the form submit handler
    // from firing when a required field (name) is blank.
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AccountForm mode="create" onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: /créer le compte/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
