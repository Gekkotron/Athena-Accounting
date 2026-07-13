import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PdfTemplateBuilder } from '../index';
import type { PdfImportNeedsTemplate } from '../../../api/pdf-templates';

// Mocking ZoneCanvas at the module boundary (rather than the brief's
// vi.doMock + dynamic re-import) — the test file already imports
// `PdfTemplateBuilder` statically above, so a static `vi.mock` is what
// actually takes effect for that import; vi.doMock only affects imports
// issued after it runs and would leave the already-resolved module graph
// bound to the real ZoneCanvas. `vi.mock` is hoisted by Vitest above all
// imports, so this works regardless of import order.
//
// The mock renders a plain button per canvas instance (keyed by
// `paintLabel`) that fires `onChange` with a fixed dummy rect on click —
// deterministic, no timer races, and it lets the test drive each step
// explicitly instead of racing the wizard's step-auto-advance behavior
// against an async setTimeout paint.
vi.mock('../ZoneCanvas', () => ({
  ZoneCanvas: (props: any) => (
    <button
      type="button"
      data-testid={`paint-${props.paintLabel ?? 'zone'}`}
      onClick={() => props.onChange({ x: 10, y: 10, w: 100, h: 20 })}
    >
      paint {props.paintLabel ?? 'zone'}
    </button>
  ),
}));

vi.mock('../../../api/pdf-templates', async () => {
  const actual = await vi.importActual<typeof import('../../../api/pdf-templates')>('../../../api/pdf-templates');
  return { ...actual, previewZones: vi.fn() };
});
import { previewZones } from '../../../api/pdf-templates';
const previewMock = vi.mocked(previewZones);

const draftId = 42;

// A minimal needs_template payload — one page, no suggested zones. The
// wizard doesn't need real image data for these assertions since
// ZoneCanvas is mocked above.
const needsTemplate: PdfImportNeedsTemplate = {
  kind: 'needs_template',
  draftId,
  fingerprint: 'test-fp',
  pages: [{ pageIndex: 0, pngBase64: 'iVBORw0KGgo=', widthPt: 595, heightPt: 842 }],
  textItems: [],
  suggestedZones: null,
  reason: 'low_confidence',
  sourceKind: 'pdf',
  ocrStatus: 'not_needed',
  ocrTotal: 0,
};

// Walks the wizard from the initial "header" step to "amount" with every
// required zone painted, so canSubmit (and therefore the Aperçu button)
// becomes enabled. Relies on the mocked ZoneCanvas button above.
function driveToAmountStep() {
  // header: headerRect already has a sensible default, so Suivant is not
  // gated on painting here.
  fireEvent.click(screen.getByRole('button', { name: /suivant/i }));
  // table: paint the table rect, then advance (selectedPages defaults to
  // "all", so that condition is already satisfied).
  fireEvent.click(screen.getByTestId('paint-zone'));
  fireEvent.click(screen.getByRole('button', { name: /suivant/i }));
  // date: the wizard auto-advances to "description" as soon as the date
  // column is painted — no explicit Suivant click.
  fireEvent.click(screen.getByTestId('paint-Date'));
  // description: same auto-advance, this time to "amount".
  fireEvent.click(screen.getByTestId('paint-Libellé'));
  // amount: default mode is the two-column Débit/Crédit layout.
  fireEvent.click(screen.getByTestId('paint-Débit'));
  fireEvent.click(screen.getByTestId('paint-Crédit'));
}

describe('PdfTemplateBuilder — preview button', () => {
  beforeEach(() => {
    previewMock.mockReset();
  });
  afterEach(() => cleanup());

  it('calls previewZones and renders extracted rows on click', async () => {
    previewMock.mockResolvedValue({
      rows: [
        { date: '2026-01-15', amount: '-42.30', rawLabel: 'CB CARREFOUR', memo: null, fitid: null },
        { date: '2026-01-17', amount: '1200.00', rawLabel: 'SALAIRE', memo: null, fitid: null },
      ],
      skippedRows: [],
    });
    render(<PdfTemplateBuilder needsTemplate={needsTemplate} onClose={vi.fn()} onImported={vi.fn()} />);

    driveToAmountStep();

    // The amount step needs a label — the <label> in AmountStep.tsx is not
    // htmlFor'd, so getByLabelText won't find the input; select by its
    // placeholder instead ("ex: BNP — Compte Chèques").
    fireEvent.change(screen.getByPlaceholderText(/BNP/i), { target: { value: 'Test Template' } });

    const previewBtn = screen.getByRole('button', { name: /aperçu/i });
    expect(previewBtn).not.toBeDisabled();
    fireEvent.click(previewBtn);

    await screen.findByText('CB CARREFOUR');
    await screen.findByText('SALAIRE');
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(previewMock.mock.calls[0]![0]).toBe(draftId);
  });

  it('renders an error banner when previewZones rejects', async () => {
    previewMock.mockRejectedValue(new Error('boom'));
    render(<PdfTemplateBuilder needsTemplate={needsTemplate} onClose={vi.fn()} onImported={vi.fn()} />);

    driveToAmountStep();
    fireEvent.change(screen.getByPlaceholderText(/BNP/i), { target: { value: 'X' } });

    fireEvent.click(screen.getByRole('button', { name: /aperçu/i }));

    await screen.findByText(/boom/i);
  });

  it('resets the preview when a painted zone changes after a successful preview', async () => {
    previewMock.mockResolvedValue({
      rows: [{ date: '2026-01-15', amount: '-42.30', rawLabel: 'CB CARREFOUR', memo: null, fitid: null }],
      skippedRows: [],
    });
    render(<PdfTemplateBuilder needsTemplate={needsTemplate} onClose={vi.fn()} onImported={vi.fn()} />);

    driveToAmountStep();
    fireEvent.change(screen.getByPlaceholderText(/BNP/i), { target: { value: 'Test Template' } });
    fireEvent.click(screen.getByRole('button', { name: /aperçu/i }));
    await screen.findByText('CB CARREFOUR');

    // Repainting the Débit column invalidates the previous preview.
    fireEvent.click(screen.getByTestId('paint-Débit'));

    expect(screen.queryByText('CB CARREFOUR')).toBeNull();
    expect(screen.getByText(/cliquez sur/i)).toBeInTheDocument();
  });

  it('ignores a preview response that resolves after a re-paint made it stale', async () => {
    // A deferred promise the test controls by hand, so we can trigger the
    // re-paint (and the reset effect it fires) *before* the response lands
    // — reproducing the request-race the reset useEffect alone can't catch.
    let resolvePreview!: (v: { rows: any[]; skippedRows: any[] }) => void;
    previewMock.mockImplementation(
      () => new Promise((resolve) => { resolvePreview = resolve; }),
    );
    render(<PdfTemplateBuilder needsTemplate={needsTemplate} onClose={vi.fn()} onImported={vi.fn()} />);

    driveToAmountStep();
    fireEvent.change(screen.getByPlaceholderText(/BNP/i), { target: { value: 'Test Template' } });
    fireEvent.click(screen.getByRole('button', { name: /aperçu/i }));

    // Re-paint the Débit column *while the request is still in flight* —
    // this fires the reset effect and (with the fix) bumps the request id.
    fireEvent.click(screen.getByTestId('paint-Débit'));

    // Now let the stale request resolve with rows for the OLD zone config.
    resolvePreview({
      rows: [{ date: '2026-01-15', amount: '-42.30', rawLabel: 'CB CARREFOUR', memo: null, fitid: null }],
      skippedRows: [],
    });
    await Promise.resolve();
    await Promise.resolve();

    // The stale rows must never appear — the panel should stay empty.
    expect(screen.queryByText('CB CARREFOUR')).toBeNull();
    expect(screen.getByText(/cliquez sur/i)).toBeInTheDocument();
  });
});
