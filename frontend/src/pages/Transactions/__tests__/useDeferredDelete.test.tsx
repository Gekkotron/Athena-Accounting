import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, render, screen } from '@testing-library/react';
import { useDeferredDelete, UNDO_WINDOW_MS } from '../useDeferredDelete';
import { UndoToast } from '../UndoToast';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useDeferredDelete', () => {
  it('hides the ids immediately and executes only after the window expires', () => {
    const execute = vi.fn();
    const { result } = renderHook(() => useDeferredDelete());

    act(() => result.current.begin([1, 2], 'bulk', execute));
    expect(result.current.hiddenIds.has(1)).toBe(true);
    expect(result.current.hiddenIds.has(2)).toBe(true);
    expect(result.current.pending?.kind).toBe('bulk');
    expect(execute).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBeNull();
    expect(result.current.hiddenIds.size).toBe(0);
  });

  it('undo cancels the pending delete — execute never fires', () => {
    const execute = vi.fn();
    const { result } = renderHook(() => useDeferredDelete());

    act(() => result.current.begin([7], 'single', execute));
    act(() => result.current.undo());
    expect(result.current.pending).toBeNull();
    expect(result.current.hiddenIds.size).toBe(0);

    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));
    expect(execute).not.toHaveBeenCalled();
  });

  it('a second delete while one is pending commits the first immediately', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result } = renderHook(() => useDeferredDelete());

    act(() => result.current.begin([1], 'single', first));
    act(() => result.current.begin([2], 'single', second));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(result.current.hiddenIds.has(2)).toBe(true);

    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unmounting flushes the pending delete instead of dropping it', () => {
    const execute = vi.fn();
    const { result, unmount } = renderHook(() => useDeferredDelete());

    act(() => result.current.begin([3], 'single', execute));
    unmount();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('unmounting after undo does NOT fire the delete', () => {
    const execute = vi.fn();
    const { result, unmount } = renderHook(() => useDeferredDelete());

    act(() => result.current.begin([3], 'single', execute));
    act(() => result.current.undo());
    unmount();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('UndoToast', () => {
  it('renders the label and fires onUndo on click', () => {
    const onUndo = vi.fn();
    render(<UndoToast label="Transaction supprimée" actionLabel="Annuler" onUndo={onUndo} />);

    expect(screen.getByRole('status')).toHaveTextContent('Transaction supprimée');
    screen.getByRole('button', { name: 'Annuler' }).click();
    expect(onUndo).toHaveBeenCalled();
  });
});
