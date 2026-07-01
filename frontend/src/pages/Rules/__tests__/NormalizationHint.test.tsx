import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NormalizationHint } from '../NormalizationHint';

describe('NormalizationHint', () => {
  it('renders nothing when matchMode is regex', () => {
    const { container } = render(<NormalizationHint input="CB carrefour 12/03" matchMode="regex" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the input is empty', () => {
    const { container } = render(<NormalizationHint input="   " matchMode="word" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the normalized preview when the keyword changes under normalization', () => {
    render(<NormalizationHint input="CB Carrefour" matchMode="word" />);
    expect(screen.getByText(/sera matché comme/i)).toBeInTheDocument();
    expect(screen.getByText('carrefour')).toBeInTheDocument();
  });

  it('warns when a keyword normalizes to empty', () => {
    render(<NormalizationHint input="12/03/2026" matchMode="word" />);
    expect(screen.getByText(/devient vide après normalisation/i)).toBeInTheDocument();
  });
});
