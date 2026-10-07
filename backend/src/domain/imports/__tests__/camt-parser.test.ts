import { describe, expect, it } from 'vitest';
import { parseCamt } from '../camt-parser.js';

const NS = 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.02';

const doc = (entries: string, prefix = '') => {
  const p = prefix ? `${prefix}:` : '';
  const xmlns = prefix ? `xmlns:${prefix}="${NS}"` : `xmlns="${NS}"`;
  return Buffer.from(
    `<?xml version="1.0"?><${p}Document ${xmlns}><${p}BkToCstmrStmt><${p}Stmt>${entries}</${p}Stmt></${p}BkToCstmrStmt></${p}Document>`,
    'utf-8',
  );
};

const entry = (o: {
  amt?: string;
  ccy?: string;
  cdi?: string;
  sts?: string;
  book?: string;
  val?: string;
  extra?: string;
}) =>
  `<Ntry>${o.sts !== undefined ? `<Sts>${o.sts}</Sts>` : ''}` +
  `${o.amt !== undefined ? `<Amt Ccy="${o.ccy ?? 'EUR'}">${o.amt}</Amt>` : ''}` +
  `${o.cdi !== undefined ? `<CdtDbtInd>${o.cdi}</CdtDbtInd>` : ''}` +
  `${o.book !== undefined ? `<BookgDt>${o.book}</BookgDt>` : ''}` +
  `${o.val !== undefined ? `<ValDt>${o.val}</ValDt>` : ''}` +
  `${o.extra ?? ''}</Ntry>`;

describe('parseCamt', () => {
  it('rejects non-CAMT documents', () => {
    expect(() => parseCamt(Buffer.from('<Document><Ntry/></Document>'))).toThrow(/not a CAMT/);
  });

  it('parses a debit entry with creditor counterparty and remittance', () => {
    const xml = doc(
      entry({
        sts: 'BOOK',
        amt: '25.30',
        cdi: 'DBIT',
        book: '<Dt>2026-06-27</Dt>',
        extra:
          '<NtryDtls><TxDtls><Refs><AcctSvcrRef>REF1</AcctSvcrRef></Refs><RltdPties><Cdtr><Nm>ACME SARL</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Facture 42</Ustrd></RmtInf></TxDtls></NtryDtls>',
      }),
    );
    expect(parseCamt(xml)).toEqual([
      { date: '2026-06-27', amount: '-25.30', rawLabel: 'Facture 42', memo: 'ACME SARL', fitid: 'REF1' },
    ]);
  });

  it('parses a credit entry using the debtor as counterparty', () => {
    const xml = doc(
      entry({
        amt: '1500.00',
        cdi: 'CRDT',
        book: '<Dt>2026-06-01</Dt>',
        extra: '<Dbtr><Nm>EMPLOYEUR</Nm></Dbtr><Cdtr><Nm>MOI</Nm></Cdtr>',
      }),
    );
    expect(parseCamt(xml)).toEqual([
      { date: '2026-06-01', amount: '1500.00', rawLabel: 'EMPLOYEUR', memo: null, fitid: null },
    ]);
  });

  it('never flips a pre-signed amount on DBIT/CRDT', () => {
    const xml = doc(
      entry({ amt: '-10.00', cdi: 'DBIT', book: '<Dt>2026-06-01</Dt>' }) +
        entry({ amt: '-10.00', cdi: 'CRDT', book: '<Dt>2026-06-01</Dt>' }),
    );
    expect(parseCamt(xml).map((r) => r.amount)).toEqual(['-10.00', '10.00']);
  });

  it('handles namespace-prefixed tags', () => {
    const xml = doc(
      '<ns2:Ntry><ns2:Amt Ccy="EUR">5.00</ns2:Amt><ns2:CdtDbtInd>CRDT</ns2:CdtDbtInd><ns2:BookgDt><ns2:Dt>2026-02-03</ns2:Dt></ns2:BookgDt></ns2:Ntry>',
      'ns2',
    );
    expect(parseCamt(xml)).toEqual([
      { date: '2026-02-03', amount: '5.00', rawLabel: 'Transaction', memo: null, fitid: null },
    ]);
  });

  it('skips pending entries but keeps entries with no status', () => {
    const xml = doc(
      entry({ sts: 'PDNG', amt: '1', cdi: 'CRDT', book: '<Dt>2026-01-01</Dt>' }) +
        entry({ amt: '2', cdi: 'CRDT', book: '<Dt>2026-01-02</Dt>' }) +
        entry({ sts: 'BOOK', amt: '3', cdi: 'CRDT', book: '<Dt>2026-01-03</Dt>' }),
    );
    expect(parseCamt(xml).map((r) => r.amount)).toEqual(['2.00', '3.00']);
  });

  it('falls back from BookgDt/Dt to DtTm and then ValDt', () => {
    const xml = doc(
      entry({ amt: '1', cdi: 'CRDT', book: '<DtTm>2026-03-04T10:00:00Z</DtTm>' }) +
        entry({ amt: '2', cdi: 'CRDT', val: '<Dt>2026-03-05</Dt>' }),
    );
    expect(parseCamt(xml).map((r) => r.date)).toEqual(['2026-03-04', '2026-03-05']);
  });

  it('skips entries missing amount, indicator, date or with bad values', () => {
    const xml = doc(
      entry({ cdi: 'CRDT', book: '<Dt>2026-01-01</Dt>' }) +
        entry({ amt: '1', book: '<Dt>2026-01-01</Dt>' }) +
        entry({ amt: '1', cdi: 'CRDT' }) +
        entry({ amt: 'abc', cdi: 'CRDT', book: '<Dt>2026-01-01</Dt>' }) +
        entry({ amt: '1', cdi: 'CRDT', book: '<Dt>01/01/2026</Dt>' }),
    );
    expect(parseCamt(xml)).toEqual([]);
  });

  it('joins multiple Ustrd fragments and drops empty ones', () => {
    const xml = doc(
      entry({
        amt: '9',
        cdi: 'DBIT',
        book: '<Dt>2026-01-01</Dt>',
        extra: '<RmtInf><Ustrd> part one </Ustrd><Ustrd></Ustrd><Ustrd>part two</Ustrd></RmtInf>',
      }),
    );
    expect(parseCamt(xml)[0]!.rawLabel).toBe('part one part two');
  });

  it('uses the counterparty as label (no memo) when remittance is absent', () => {
    const xml = doc(
      entry({
        amt: '9',
        cdi: 'DBIT',
        book: '<Dt>2026-01-01</Dt>',
        extra: '<Cdtr><Nm>BOULANGERIE</Nm></Cdtr>',
      }),
    );
    const [row] = parseCamt(xml);
    expect(row!.rawLabel).toBe('BOULANGERIE');
    expect(row!.memo).toBeNull();
  });

  it('picks fitid by priority AcctSvcrRef, EndToEndId, NtryRef', () => {
    const mk = (extra: string) =>
      parseCamt(doc(entry({ amt: '1', cdi: 'CRDT', book: '<Dt>2026-01-01</Dt>', extra })))[0]!.fitid;
    expect(mk('<EndToEndId>E</EndToEndId><AcctSvcrRef>A</AcctSvcrRef>')).toBe('A');
    expect(mk('<EndToEndId>E</EndToEndId><NtryRef>N</NtryRef>')).toBe('E');
    expect(mk('<NtryRef>N</NtryRef>')).toBe('N');
    expect(mk('')).toBeNull();
  });

  it('keeps amounts from non-EUR entries as plain magnitudes', () => {
    const xml = doc(
      entry({ amt: '100.5', ccy: 'USD', cdi: 'DBIT', book: '<Dt>2026-01-01</Dt>' }) +
        entry({ amt: '7', ccy: 'GBP', cdi: 'CRDT', book: '<Dt>2026-01-02</Dt>' }),
    );
    expect(parseCamt(xml).map((r) => r.amount)).toEqual(['-100.50', '7.00']);
  });

  it('returns an empty list for a CAMT document with no entries', () => {
    expect(parseCamt(doc(''))).toEqual([]);
  });

  it('accepts CAMT.052 namespaces', () => {
    const xml = Buffer.from(
      `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02"><Ntry><Amt>1</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-01-01</Dt></BookgDt></Ntry></Document>`,
    );
    expect(parseCamt(xml)).toHaveLength(1);
  });
});
