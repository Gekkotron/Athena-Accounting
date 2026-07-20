import { describe, it, expect } from 'vitest';
import {
  buildZones,
  buildReferenceRects,
  isAmountReady,
  isReadyToSubmit,
  type ZonesInput,
  type ColumnLabels,
  type RectsInput,
} from '../lib';

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

const baseInput = (): ZonesInput => ({
  headerRect: rect(0, 0, 595, 100),
  tableRect: rect(20, 200, 555, 500),
  tableRepeats: true,
  selectedPages: [2, 0, 1],
  pickedAnchor: null,
  pickedOtherAnchors: [],
  dateCol: rect(20, 200, 60, 500),
  descCol: rect(90, 200, 300, 500),
  amountMode: 'pair',
  signedCol: null,
  debitCol: rect(400, 200, 80, 500),
  creditCol: rect(490, 200, 80, 500),
});

const labels: ColumnLabels = {
  table: 'Table',
  date: 'Date',
  description: 'Description',
  amount: 'Montant',
  debit: 'Débit',
  credit: 'Crédit',
};

describe('buildZones', () => {
  it('assembles a valid pair-mode payload with sorted pages and no anchor overrides', () => {
    const zones = buildZones(baseInput());
    expect(zones).not.toBeNull();
    expect(zones!.headerZone).toEqual({ page: 0, x: 0, y: 0, w: 595, h: 100 });
    expect(zones!.tableZone).toEqual({ page: 0, x: 20, y: 200, w: 555, h: 500 });
    expect(zones!.tableRepeatsPerPage).toBe(true);
    expect(zones!.selectedPages).toEqual([0, 1, 2]);
    expect(zones!.rowsStartY).toBe(200);
    expect(zones!.columns.map((c) => c.role)).toEqual(['date', 'description', 'debit', 'credit']);
    expect(zones!.pageAnchor).toBeUndefined();
    expect(zones!.otherAnchors).toBeUndefined();
  });

  it('assembles a valid signed-mode payload with amountSigned column', () => {
    const zones = buildZones({
      ...baseInput(),
      amountMode: 'signed',
      signedCol: rect(400, 200, 100, 500),
      debitCol: null,
      creditCol: null,
    });
    expect(zones).not.toBeNull();
    expect(zones!.columns.map((c) => c.role)).toEqual(['date', 'description', 'amountSigned']);
    const signed = zones!.columns.find((c) => c.role === 'amountSigned')!;
    expect(signed.xStart).toBe(400);
    expect(signed.xEnd).toBe(500);
  });

  it('returns null when tableRect is missing', () => {
    expect(buildZones({ ...baseInput(), tableRect: null })).toBeNull();
  });

  it('returns null when dateCol is missing', () => {
    expect(buildZones({ ...baseInput(), dateCol: null })).toBeNull();
  });

  it('returns null when descCol is missing', () => {
    expect(buildZones({ ...baseInput(), descCol: null })).toBeNull();
  });

  it('returns null in signed mode when signedCol is missing', () => {
    expect(
      buildZones({
        ...baseInput(),
        amountMode: 'signed',
        signedCol: null,
        debitCol: null,
        creditCol: null,
      }),
    ).toBeNull();
  });

  it('returns null in pair mode when either debitCol or creditCol is missing', () => {
    expect(buildZones({ ...baseInput(), debitCol: null })).toBeNull();
    expect(buildZones({ ...baseInput(), creditCol: null })).toBeNull();
  });

  it('emits pageAnchor and sorted otherAnchors only when explicitly picked', () => {
    const zones = buildZones({
      ...baseInput(),
      pickedAnchor: 'BNP',
      pickedOtherAnchors: ['LCL', 'AXA', 'BOURSORAMA'],
    });
    expect(zones!.pageAnchor).toBe('BNP');
    expect(zones!.otherAnchors).toEqual(['AXA', 'BOURSORAMA', 'LCL']);
  });

  it('does not mutate the input arrays when sorting', () => {
    const input = baseInput();
    const pagesBefore = [...input.selectedPages];
    input.pickedOtherAnchors = ['Z', 'A'];
    const anchorsBefore = [...input.pickedOtherAnchors];
    buildZones(input);
    expect(input.selectedPages).toEqual(pagesBefore);
    expect(input.pickedOtherAnchors).toEqual(anchorsBefore);
  });

  it('carries tableRect.y through as rowsStartY', () => {
    const zones = buildZones({ ...baseInput(), tableRect: rect(20, 273.5, 555, 400) });
    expect(zones!.rowsStartY).toBe(273.5);
  });
});

describe('buildReferenceRects', () => {
  const baseRects = (): RectsInput => ({
    tableRect: rect(20, 200, 555, 500),
    dateCol: rect(20, 200, 60, 500),
    descCol: rect(90, 200, 300, 500),
    amountMode: 'pair',
    signedCol: null,
    debitCol: rect(400, 200, 80, 500),
    creditCol: rect(490, 200, 80, 500),
  });

  it('always includes tableRect, hides the current-canvas column, and shows the others', () => {
    const refs = buildReferenceRects(baseRects(), labels, 'date');
    expect(refs.map((r) => r.label)).toEqual(['Table', 'Description', 'Débit', 'Crédit']);
  });

  it('omits nulls without pushing them as refs', () => {
    const refs = buildReferenceRects(
      { ...baseRects(), tableRect: null, descCol: null },
      labels,
      'debit',
    );
    expect(refs.map((r) => r.label)).toEqual(['Date', 'Crédit']);
  });

  it('in signed mode shows the signed column (unless current) and never debit/credit', () => {
    const refs = buildReferenceRects(
      { ...baseRects(), amountMode: 'signed', signedCol: rect(400, 200, 100, 500) },
      labels,
      'date',
    );
    expect(refs.map((r) => r.label)).toEqual(['Table', 'Description', 'Montant']);
    const currentSigned = buildReferenceRects(
      { ...baseRects(), amountMode: 'signed', signedCol: rect(400, 200, 100, 500) },
      labels,
      'signed',
    );
    expect(currentSigned.map((r) => r.label)).toEqual(['Table', 'Date', 'Description']);
  });
});

describe('isAmountReady', () => {
  it('signed mode: true only when signedCol is set', () => {
    expect(isAmountReady({ amountMode: 'signed', signedCol: null, debitCol: null, creditCol: null })).toBe(false);
    expect(
      isAmountReady({
        amountMode: 'signed',
        signedCol: rect(0, 0, 10, 10),
        debitCol: null,
        creditCol: null,
      }),
    ).toBe(true);
  });

  it('pair mode: true only when both debitCol and creditCol are set', () => {
    expect(
      isAmountReady({ amountMode: 'pair', signedCol: null, debitCol: rect(0, 0, 1, 1), creditCol: null }),
    ).toBe(false);
    expect(
      isAmountReady({ amountMode: 'pair', signedCol: null, debitCol: null, creditCol: rect(0, 0, 1, 1) }),
    ).toBe(false);
    expect(
      isAmountReady({
        amountMode: 'pair',
        signedCol: null,
        debitCol: rect(0, 0, 1, 1),
        creditCol: rect(0, 0, 1, 1),
      }),
    ).toBe(true);
  });
});

describe('isReadyToSubmit', () => {
  const baseSubmit = () => ({
    tableRect: rect(20, 200, 555, 500),
    dateCol: rect(20, 200, 60, 500),
    descCol: rect(90, 200, 300, 500),
    amountMode: 'pair' as const,
    signedCol: null,
    debitCol: rect(400, 200, 80, 500),
    creditCol: rect(490, 200, 80, 500),
  });

  it('true when every rect is set and label is non-empty after trim', () => {
    expect(isReadyToSubmit(baseSubmit(), 'BNP mars')).toBe(true);
  });

  it('false when label is blank or whitespace-only', () => {
    expect(isReadyToSubmit(baseSubmit(), '')).toBe(false);
    expect(isReadyToSubmit(baseSubmit(), '   ')).toBe(false);
  });

  it('false when any rect is missing', () => {
    expect(isReadyToSubmit({ ...baseSubmit(), tableRect: null }, 'x')).toBe(false);
    expect(isReadyToSubmit({ ...baseSubmit(), dateCol: null }, 'x')).toBe(false);
    expect(isReadyToSubmit({ ...baseSubmit(), descCol: null }, 'x')).toBe(false);
    expect(isReadyToSubmit({ ...baseSubmit(), debitCol: null }, 'x')).toBe(false);
    expect(isReadyToSubmit({ ...baseSubmit(), creditCol: null }, 'x')).toBe(false);
  });
});
