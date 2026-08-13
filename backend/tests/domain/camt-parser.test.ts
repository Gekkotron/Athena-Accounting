import { describe, it, expect } from 'vitest';
import { parseCamt } from '../../src/domain/imports/camt-parser.js';

// Synthetic ISO 20022 fixtures. Structure follows the CAMT.053.001.02 /
// CAMT.052.001.02 examples from the ISO 20022 message set — trimmed to the
// fields Athena consumes. No real bank statement is ever committed.

function camt053(ntries: string, opts: { namespace?: string } = {}): Buffer {
  const ns = opts.namespace ?? 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.02';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="${ns}">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>msg-1</MsgId>
      <CreDtTm>2026-06-15T00:00:00</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>stmt-1</Id>
      <ElctrncSeqNb>1</ElctrncSeqNb>
      <CreDtTm>2026-06-15T00:00:00</CreDtTm>
      ${ntries}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
  return Buffer.from(xml, 'utf-8');
}

function camt052(ntries: string): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02">
  <BkToCstmrAcctRpt>
    <GrpHdr>
      <MsgId>msg-1</MsgId>
      <CreDtTm>2026-06-15T12:00:00</CreDtTm>
    </GrpHdr>
    <Rpt>
      <Id>rpt-1</Id>
      <CreDtTm>2026-06-15T12:00:00</CreDtTm>
      ${ntries}
    </Rpt>
  </BkToCstmrAcctRpt>
</Document>`;
  return Buffer.from(xml, 'utf-8');
}

function ntry(fields: {
  amount: string;
  ccy?: string;
  cdtDbt: 'DBIT' | 'CRDT';
  status?: string;
  bookgDate?: string;
  valDate?: string;
  ref?: string;
  ustrd?: string;
  counterpartyName?: string;
  counterpartySide?: 'Cdtr' | 'Dbtr';
}): string {
  const status = fields.status ?? 'BOOK';
  const bookg = fields.bookgDate ? `<BookgDt><Dt>${fields.bookgDate}</Dt></BookgDt>` : '';
  const val = fields.valDate ? `<ValDt><Dt>${fields.valDate}</Dt></ValDt>` : '';
  const refTag = fields.ref ? `<AcctSvcrRef>${fields.ref}</AcctSvcrRef>` : '';
  const ustrd = fields.ustrd
    ? `<RmtInf><Ustrd>${fields.ustrd}</Ustrd></RmtInf>`
    : '';
  const cp = fields.counterpartyName
    ? `<RltdPties><${fields.counterpartySide ?? 'Cdtr'}><Nm>${fields.counterpartyName}</Nm></${fields.counterpartySide ?? 'Cdtr'}></RltdPties>`
    : '';
  const dtls = ustrd || cp
    ? `<NtryDtls><TxDtls>${ustrd}${cp}</TxDtls></NtryDtls>`
    : '';
  return `<Ntry>
    <Amt Ccy="${fields.ccy ?? 'EUR'}">${fields.amount}</Amt>
    <CdtDbtInd>${fields.cdtDbt}</CdtDbtInd>
    <Sts>${status}</Sts>
    ${bookg}
    ${val}
    ${refTag}
    ${dtls}
  </Ntry>`;
}

describe('parseCamt (CAMT.053)', () => {
  it('parses a booked DBIT entry with a negative signed amount', () => {
    const buf = camt053(ntry({
      amount: '25.30',
      cdtDbt: 'DBIT',
      bookgDate: '2026-06-15',
      ref: 'REF-123',
      ustrd: 'CARREFOUR MULHOUSE',
      counterpartyName: 'CARREFOUR',
    }));
    const rows = parseCamt(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-06-15',
      amount: '-25.30',
      rawLabel: 'CARREFOUR MULHOUSE',
      fitid: 'REF-123',
    });
  });

  it('parses a booked CRDT entry with a positive signed amount', () => {
    const buf = camt053(ntry({
      amount: '1200.00',
      cdtDbt: 'CRDT',
      bookgDate: '2026-06-14',
      ref: 'PAYROLL-01',
      ustrd: 'SALAIRE MAI',
      counterpartyName: 'ACME SARL',
      counterpartySide: 'Dbtr',
    }));
    const rows = parseCamt(buf);
    expect(rows[0]).toMatchObject({
      date: '2026-06-14',
      amount: '1200.00',
      rawLabel: 'SALAIRE MAI',
      fitid: 'PAYROLL-01',
    });
  });

  it('applies the sign to the magnitude — a pre-signed DBIT amount stays negative', () => {
    // Some exporters put a minus in front of the value even though the
    // direction is already carried by CdtDbtInd. The ISO 20022 rule is the
    // indicator wins; the magnitude decides how far from zero we are.
    const buf = camt053(ntry({
      amount: '-25.30',
      cdtDbt: 'DBIT',
      bookgDate: '2026-06-15',
    }));
    expect(parseCamt(buf)[0]!.amount).toBe('-25.30');
  });

  it('falls back to the counterparty name when remittance is empty', () => {
    const buf = camt053(ntry({
      amount: '9.99',
      cdtDbt: 'DBIT',
      bookgDate: '2026-06-15',
      counterpartyName: 'ONLY COUNTERPARTY',
    }));
    expect(parseCamt(buf)[0]!.rawLabel).toBe('ONLY COUNTERPARTY');
  });

  it('emits "Transaction" when both remittance and counterparty are absent', () => {
    const buf = camt053(ntry({
      amount: '5.00',
      cdtDbt: 'DBIT',
      bookgDate: '2026-06-15',
    }));
    expect(parseCamt(buf)[0]!.rawLabel).toBe('Transaction');
  });

  it('prefers BookgDt over ValDt', () => {
    const buf = camt053(ntry({
      amount: '1.00',
      cdtDbt: 'CRDT',
      bookgDate: '2026-06-15',
      valDate: '2026-06-14',
    }));
    expect(parseCamt(buf)[0]!.date).toBe('2026-06-15');
  });

  it('uses ValDt when BookgDt is absent', () => {
    const buf = camt053(ntry({
      amount: '1.00',
      cdtDbt: 'CRDT',
      valDate: '2026-06-14',
    }));
    expect(parseCamt(buf)[0]!.date).toBe('2026-06-14');
  });

  it('filters out PDNG (pending) entries — only BOOK lands in the ledger', () => {
    const buf = camt053(`
      ${ntry({ amount: '1.00', cdtDbt: 'DBIT', status: 'BOOK', bookgDate: '2026-06-15', ustrd: 'BOOKED' })}
      ${ntry({ amount: '2.00', cdtDbt: 'DBIT', status: 'PDNG', bookgDate: '2026-06-15', ustrd: 'PENDING' })}
    `);
    const rows = parseCamt(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawLabel).toBe('BOOKED');
  });

  it('parses multiple back-to-back Ntry blocks', () => {
    const buf = camt053(`
      ${ntry({ amount: '1.00', cdtDbt: 'DBIT', bookgDate: '2026-06-15', ustrd: 'A' })}
      ${ntry({ amount: '2.50', cdtDbt: 'CRDT', bookgDate: '2026-06-16', ustrd: 'B' })}
      ${ntry({ amount: '3.14', cdtDbt: 'DBIT', bookgDate: '2026-06-17', ustrd: 'C' })}
    `);
    const rows = parseCamt(buf);
    expect(rows.map((r) => r.rawLabel)).toEqual(['A', 'B', 'C']);
    expect(rows.map((r) => r.amount)).toEqual(['-1.00', '2.50', '-3.14']);
  });

  it('returns [] for a valid but empty CAMT.053 statement', () => {
    const buf = camt053('');
    expect(parseCamt(buf)).toEqual([]);
  });

  it('joins multiple Ustrd fragments in remittance info', () => {
    const buf = camt053(`
      <Ntry>
        <Amt Ccy="EUR">10.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-06-15</Dt></BookgDt>
        <NtryDtls><TxDtls><RmtInf>
          <Ustrd>PART ONE</Ustrd>
          <Ustrd>PART TWO</Ustrd>
        </RmtInf></TxDtls></NtryDtls>
      </Ntry>
    `);
    expect(parseCamt(buf)[0]!.rawLabel).toBe('PART ONE PART TWO');
  });

  it('handles namespaced element prefixes (ns2:Ntry)', () => {
    // Some banks emit prefixed elements. Parser must strip the prefix so the
    // same field extraction works.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:Document xmlns:ns2="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <ns2:BkToCstmrStmt>
    <ns2:Stmt>
      <ns2:Ntry>
        <ns2:Amt Ccy="EUR">7.77</ns2:Amt>
        <ns2:CdtDbtInd>DBIT</ns2:CdtDbtInd>
        <ns2:Sts>BOOK</ns2:Sts>
        <ns2:BookgDt><ns2:Dt>2026-06-15</ns2:Dt></ns2:BookgDt>
        <ns2:NtryDtls><ns2:TxDtls>
          <ns2:RmtInf><ns2:Ustrd>PREFIXED</ns2:Ustrd></ns2:RmtInf>
        </ns2:TxDtls></ns2:NtryDtls>
      </ns2:Ntry>
    </ns2:Stmt>
  </ns2:BkToCstmrStmt>
</ns2:Document>`;
    const rows = parseCamt(Buffer.from(xml, 'utf-8'));
    expect(rows[0]).toMatchObject({
      date: '2026-06-15',
      amount: '-7.77',
      rawLabel: 'PREFIXED',
    });
  });
});

describe('parseCamt (CAMT.052 intraday)', () => {
  it('parses an intraday report using BkToCstmrAcctRpt/Rpt', () => {
    const buf = camt052(ntry({
      amount: '42.00',
      cdtDbt: 'DBIT',
      bookgDate: '2026-06-15',
      ref: 'INTRA-1',
      ustrd: 'AMAZON EU',
    }));
    const rows = parseCamt(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-06-15',
      amount: '-42.00',
      rawLabel: 'AMAZON EU',
      fitid: 'INTRA-1',
    });
  });
});

describe('parseCamt (rejection)', () => {
  it('rejects XML whose namespace is neither CAMT.053 nor CAMT.052', () => {
    const buf = Buffer.from(
      '<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"/>',
      'utf-8',
    );
    expect(() => parseCamt(buf)).toThrow(/CAMT\.053|CAMT\.052/i);
  });

  it('rejects arbitrary XML with no ISO 20022 namespace', () => {
    const buf = Buffer.from('<?xml version="1.0"?><foo><bar/></foo>', 'utf-8');
    expect(() => parseCamt(buf)).toThrow(/CAMT/i);
  });

  it('rejects a non-XML payload', () => {
    const buf = Buffer.from('not even xml', 'utf-8');
    expect(() => parseCamt(buf)).toThrow(/CAMT/i);
  });
});
