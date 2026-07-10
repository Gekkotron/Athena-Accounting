import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sankey } from '../Sankey';
import { buildSankeyModel } from '../../pages/Dashboard/sankey';
import type { Category, CategoryReportRow } from '../../api/types';

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
