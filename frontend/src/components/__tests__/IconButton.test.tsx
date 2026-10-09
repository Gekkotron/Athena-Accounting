import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { IconButton } from '../IconButton';

describe('IconButton', () => {
  it('renders a button with the required aria-label and fires onClick', () => {
    const onClick = vi.fn();
    render(
      <IconButton aria-label="close" onClick={onClick}>
        <svg data-testid="icon" />
      </IconButton>,
    );
    const btn = screen.getByRole('button', { name: 'close' });
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('defaults to type=button to avoid accidental form submission', () => {
    render(
      <IconButton aria-label="x">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('applies the secondary variant classes when variant="secondary"', () => {
    render(
      <IconButton aria-label="menu" variant="secondary">
        <svg />
      </IconButton>,
    );
    const btn = screen.getByRole('button', { name: 'menu' });
    expect(btn.className).toContain('border');
    expect(btn.className).toContain('bg-ink-900/70');
  });

  it('forwards ref and merges custom className', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <IconButton ref={ref} aria-label="bell" className="relative">
        <svg />
      </IconButton>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current!.className).toContain('relative');
    expect(ref.current!.className).toContain('btn-icon');
  });
});
