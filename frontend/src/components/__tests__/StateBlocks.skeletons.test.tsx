import { it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChartSkeleton, StatGridSkeleton, ListSkeleton } from '../StateBlocks';

it('ChartSkeleton renders 8 pulsing bars with aria-busy', () => {
  const { container } = render(<ChartSkeleton />);
  const root = container.firstElementChild;
  expect(root).not.toBeNull();
  expect(root!.getAttribute('aria-busy')).toBe('true');
  expect(root!.getAttribute('aria-live')).toBe('polite');
  // 8 column stubs — the array length in CHART_SKELETON_HEIGHTS.
  const bars = container.querySelectorAll('[style*="height"]');
  expect(bars.length).toBe(8);
});

it('StatGridSkeleton renders n tiles and carries aria-busy', () => {
  const { container } = render(<StatGridSkeleton n={3} />);
  const root = container.firstElementChild!;
  expect(root.getAttribute('aria-busy')).toBe('true');
  // Each tile is a `.surface p-5` div with three stub bars inside — count
  // via the tile wrapper class.
  const tiles = container.querySelectorAll('.surface.p-5');
  expect(tiles.length).toBe(3);
});

it('StatGridSkeleton respects the n prop', () => {
  const { container } = render(<StatGridSkeleton n={5} />);
  expect(container.querySelectorAll('.surface.p-5').length).toBe(5);
});

it('ListSkeleton renders `rows` row-stubs with aria-busy', () => {
  const { container } = render(<ListSkeleton rows={4} />);
  const root = container.firstElementChild!;
  expect(root.getAttribute('aria-busy')).toBe('true');
  // Each row has one circular icon stub — 4 rows → 4 circles.
  const icons = container.querySelectorAll('.rounded-full');
  expect(icons.length).toBe(4);
});
