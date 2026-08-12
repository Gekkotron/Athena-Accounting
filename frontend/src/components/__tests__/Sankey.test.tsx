import { it, expect } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { Sankey } from '../Sankey';
import { buildSankeyModel } from '../../pages/Dashboard/sankey';
import type { Category, CategoryReportRow } from '../../api/types';
import { pinLocale } from '../../test/i18n';

pinLocale('charts');

const cat = (id: number, name: string, kind: Category['kind']): Category => ({
  id, name, kind, color: null, parentId: null, isDefault: false, isInternalTransfer: false,
});
const row = (id: number, kind: CategoryReportRow['category_kind'], total: string): CategoryReportRow => ({
  category_id: id, category_name: null, category_kind: kind, category_is_internal_transfer: false,
  month: '2026-06', total, transaction_count: 1,
});

it('renders node labels including the Revenus pool and Épargne', () => {
  const model = buildSankeyModel(
    [row(1, 'income', '3000'), row(2, 'expense', '-800')],
    [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')],
    'EUR',
  );
  render(<Sankey model={model} />);
  expect(screen.getByText('Salaire')).toBeInTheDocument();
  expect(screen.getByText('Courses')).toBeInTheDocument();
  expect(screen.getByText('Revenus')).toBeInTheDocument();
  expect(screen.getByText('Épargne')).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('aria-label');
});

it('exposes each Sankey node as a keyboard-reachable button with a descriptive aria-label', () => {
  const model = buildSankeyModel(
    [row(1, 'income', '3000'), row(2, 'expense', '-800')],
    [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')],
    'EUR',
  );
  render(<Sankey model={model} />);
  const nodes = screen.getAllByRole('button');
  // At minimum: Salaire (income) + Courses (expense) + Épargne node — the
  // central pool spine is not a node. Each is tabbable and carries a label.
  expect(nodes.length).toBeGreaterThanOrEqual(3);
  for (const n of nodes) {
    expect(n).toHaveAttribute('tabindex', '0');
    expect(n.getAttribute('aria-label')).toMatch(/\d+/); // amount is in the label
  }
});

// Reads ribbon opacities off the paths — a highlighted ribbon is >=0.7 and a
// dimmed one is <=0.1, per the two-tier scheme in Sankey.tsx.
function ribbonOpacities(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('svg > g > path')).map((p) =>
    parseFloat(p.getAttribute('opacity') || '1'),
  );
}

it('focus mirrors mouse hover: highlights the focused ribbon and dims the rest', () => {
  const model = buildSankeyModel(
    [row(1, 'income', '3000'), row(2, 'expense', '-500'), row(3, 'expense', '-500')],
    [cat(1, 'Salaire', 'income'), cat(2, 'Loyer', 'expense'), cat(3, 'Courses', 'expense')],
    'EUR',
  );
  const { container } = render(<Sankey model={model} />);
  const baseline = ribbonOpacities(container);
  expect(baseline.every((o) => Math.abs(o - 0.32) < 1e-6)).toBe(true);

  fireEvent.focus(screen.getByRole('button', { name: /Salaire/ }));
  const focused = ribbonOpacities(container);
  expect(focused.some((o) => o >= 0.7)).toBe(true);
  expect(focused.some((o) => o > 0 && o <= 0.1)).toBe(true);
});

it('Escape on a focused node calls .blur() on the target', () => {
  const model = buildSankeyModel(
    [row(1, 'income', '3000'), row(2, 'expense', '-800')],
    [cat(1, 'Salaire', 'income'), cat(2, 'Courses', 'expense')],
    'EUR',
  );
  render(<Sankey model={model} />);
  const salaire = screen.getByRole('button', { name: /Salaire/ });
  act(() => { salaire.focus(); });
  expect(document.activeElement).toBe(salaire);

  fireEvent.keyDown(salaire, { key: 'Escape' });
  // The Escape handler in Sankey.tsx calls e.currentTarget.blur(); in the
  // browser that unfocuses the element. jsdom updates activeElement the same
  // way — but does not reliably fire focusout on SVG groups, which is why
  // the onBlur → state-reset side of the flow is asserted separately below.
  expect(document.activeElement).not.toBe(salaire);
});

it('blur on a focused node resets the state flip so ribbons return to baseline', () => {
  const model = buildSankeyModel(
    [row(1, 'income', '3000'), row(2, 'expense', '-500'), row(3, 'expense', '-500')],
    [cat(1, 'Salaire', 'income'), cat(2, 'Loyer', 'expense'), cat(3, 'Courses', 'expense')],
    'EUR',
  );
  const { container } = render(<Sankey model={model} />);
  const salaire = screen.getByRole('button', { name: /Salaire/ });
  fireEvent.focus(salaire);
  expect(ribbonOpacities(container).some((o) => o >= 0.7)).toBe(true);

  fireEvent.blur(salaire);
  expect(ribbonOpacities(container).every((o) => Math.abs(o - 0.32) < 1e-6)).toBe(true);
});

it('focusing the aggregated Autres tail reveals its breakdown tooltip', () => {
  // topNExpense: 1 keeps only the largest expense as its own node — the rest
  // are aggregated into "Autres" and the aggregate node carries a breakdown.
  const model = buildSankeyModel(
    [
      row(1, 'income', '3000'),
      row(2, 'expense', '-500'),
      row(3, 'expense', '-300'),
      row(4, 'expense', '-200'),
    ],
    [
      cat(1, 'Salaire', 'income'),
      cat(2, 'Loyer', 'expense'),
      cat(3, 'Courses', 'expense'),
      cat(4, 'Loisirs', 'expense'),
    ],
    'EUR',
    { topNExpense: 1 },
  );
  render(<Sankey model={model} />);
  expect(screen.queryByRole('tooltip')).toBeNull();

  const autres = screen.getByRole('button', { name: /Autres/ });
  fireEvent.focus(autres);
  const tooltip = screen.getByRole('tooltip');
  // Both aggregated categories are listed inside the tooltip.
  expect(within(tooltip).getByText('Courses')).toBeInTheDocument();
  expect(within(tooltip).getByText('Loisirs')).toBeInTheDocument();
});
