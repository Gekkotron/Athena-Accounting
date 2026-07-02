import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CategoryDonut, type CategorySegment } from '../CategoryDonut';

const seg = (name: string, amount: number, color: string | null = null): CategorySegment => ({
  id: name.charCodeAt(0),
  name,
  color,
  amount,
});

describe('CategoryDonut', () => {
  it('renders the empty-state copy when the total is zero', () => {
    render(<CategoryDonut data={[]} />);
    expect(screen.getByText(/pas encore de données/i)).toBeInTheDocument();
  });

  it('skips segments with non-positive amounts', () => {
    render(<CategoryDonut data={[seg('A', 100), seg('B', 0), seg('C', -5)]} />);
    // Only "A" should appear in the legend.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
    expect(screen.queryByText('C')).not.toBeInTheDocument();
  });

  it('renders one legend row per positive segment, largest first', () => {
    render(<CategoryDonut data={[seg('Small', 20), seg('Big', 80), seg('Mid', 50)]} />);
    // Legend items should be sorted by amount desc: Big, Mid, Small.
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => (i.textContent ?? '').match(/^[A-Za-z]+/)?.[0]))
      .toEqual(['Big', 'Mid', 'Small']);
  });

  it('shows the center label default "TOTAL" when none provided', () => {
    render(<CategoryDonut data={[seg('A', 100)]} />);
    // The default is "Total", uppercase-transformed via CSS. Text node stays lowercase.
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('honors an explicit centerLabel prop', () => {
    render(<CategoryDonut data={[seg('A', 100)]} centerLabel="Dépenses" />);
    expect(screen.getByText('Dépenses')).toBeInTheDocument();
  });

  it('renders each segment percentage in the legend', () => {
    render(<CategoryDonut data={[seg('A', 75), seg('B', 25)]} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('uses category color when provided, falls back to palette otherwise', () => {
    const { container } = render(
      <CategoryDonut data={[seg('A', 60, '#ff0000'), seg('B', 40, null)]} />,
    );
    // Explicit color survives; missing color pulls from the fallback palette.
    // Fallback is indexed by position in the sorted list — so B (2nd sorted)
    // gets palette[1] = '#dc7861'.
    const circles = container.querySelectorAll('svg g circle');
    const strokes = Array.from(circles).map((c) => c.getAttribute('stroke'));
    expect(strokes).toContain('#ff0000');
    expect(strokes).toContain('#dc7861');
  });

  it('hovering a legend row swaps the center text to that segment\'s percentage', () => {
    render(<CategoryDonut data={[seg('Alpha', 75), seg('Beta', 25)]} />);
    // Center defaults to the total (formatted amount). After hover, it becomes "75%".
    const alphaRow = screen.getByText('Alpha').closest('li') as HTMLLIElement;
    fireEvent.mouseEnter(alphaRow);
    // "75%" now appears twice: legend row + center. Check via getAllByText.
    expect(screen.getAllByText('75%').length).toBeGreaterThanOrEqual(2);
    fireEvent.mouseLeave(alphaRow);
  });
});
