import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTransactionShortcuts } from '../useTransactionShortcuts';
import type { Transaction } from '../../../api/types';

const tx = (id: number): Transaction =>
  ({ id, accountId: 1, date: '2026-01-01', amount: '-10.00', rawLabel: `tx ${id}` }) as Transaction;

const ROWS = [tx(1), tx(2), tx(3)];

function press(key: string, target?: EventTarget) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  if (target) Object.defineProperty(event, 'target', { value: target });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function setup(over: Partial<Parameters<typeof useTransactionShortcuts>[0]> = {}) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const focusSearch = vi.fn();
  const initial = { rows: ROWS, disabled: false, onEdit, onDelete, focusSearch, ...over };
  const view = renderHook((props) => useTransactionShortcuts(props), { initialProps: initial });
  return { ...view, onEdit, onDelete, focusSearch };
}

describe('useTransactionShortcuts', () => {
  it('j moves the cursor down, k back up, both clamped to the list', () => {
    const { result } = setup();
    expect(result.current.cursorId).toBeNull();

    press('j');
    expect(result.current.cursorId).toBe(1);
    press('j');
    press('j');
    press('j'); // clamped at the last row
    expect(result.current.cursorId).toBe(3);

    press('k');
    expect(result.current.cursorId).toBe(2);
    press('k');
    press('k'); // clamped at the first row
    expect(result.current.cursorId).toBe(1);
  });

  it('e edits and d deletes the cursor row; both are no-ops without a cursor', () => {
    const { result, onEdit, onDelete } = setup();

    press('e');
    press('d');
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();

    press('j');
    press('j');
    expect(result.current.cursorId).toBe(2);
    press('e');
    expect(onEdit).toHaveBeenCalledWith(ROWS[1]);
    press('d');
    expect(onDelete).toHaveBeenCalledWith(ROWS[1]);
  });

  it('/ focuses the search input and prevents the default keystroke', () => {
    const { focusSearch } = setup();
    const event = press('/');
    expect(focusSearch).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('is inert while typing in a form control', () => {
    const { result, focusSearch } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);

    press('j', input);
    press('/', input);
    expect(result.current.cursorId).toBeNull();
    expect(focusSearch).not.toHaveBeenCalled();
    input.remove();
  });

  it('is inert while disabled (modal open)', () => {
    const { result, onEdit, rerender } = setup();
    press('j');
    expect(result.current.cursorId).toBe(1);

    rerender({ rows: ROWS, disabled: true, onEdit, onDelete: vi.fn(), focusSearch: vi.fn() });
    press('j');
    press('e');
    expect(result.current.cursorId).toBe(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('ignores chorded keys (Cmd/Ctrl/Alt)', () => {
    const { result } = setup();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true }));
    });
    expect(result.current.cursorId).toBeNull();
  });

  it('clamps the cursorId when the list shrinks under the cursor', () => {
    const { result, rerender, onEdit, onDelete, focusSearch } = setup();
    press('j');
    press('j');
    press('j');
    expect(result.current.cursorId).toBe(3);

    rerender({ rows: ROWS.slice(0, 2), disabled: false, onEdit, onDelete, focusSearch });
    expect(result.current.cursorId).toBe(2);
  });
});
