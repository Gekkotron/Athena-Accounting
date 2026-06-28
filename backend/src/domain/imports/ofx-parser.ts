import iconv from 'iconv-lite';

export interface ParsedTransaction {
  date: string;            // YYYY-MM-DD
  amount: string;          // signed decimal "-25.30"
  rawLabel: string;        // NAME, possibly augmented with MEMO
  memo: string | null;
  fitid: string | null;
}

// OFX in French banks is SGML, not XML: tags are often not closed
// (e.g. `<TRNAMT>-25.30` followed by a newline + the next tag). The header
// before <OFX> declares the encoding (often Windows-1252).

const HEADER_END_RE = /<OFX>/i;

function detectCharset(rawHead: string): string {
  // The header section is ASCII-safe; reading it as latin1 is fine.
  const m = rawHead.match(/CHARSET\s*:\s*([^\r\n]+)/i);
  const cs = m?.[1]?.trim().toUpperCase();
  if (!cs) return 'utf-8';
  if (cs === '1252' || cs === 'WINDOWS-1252') return 'windows-1252';
  if (cs === 'ISO-8859-1' || cs === 'LATIN1') return 'iso-8859-1';
  if (cs === 'UTF-8') return 'utf-8';
  if (cs === 'USASCII' || cs === 'US-ASCII') return 'utf-8';
  return 'utf-8';
}

export function decodeOfxBuffer(buf: Buffer): string {
  // Pull a small head as latin1 (safe lossless single-byte) to read the OFX
  // header — it's ASCII so any single-byte decode works.
  const headEnd = (() => {
    const m = HEADER_END_RE.exec(buf.toString('latin1', 0, Math.min(buf.length, 4096)));
    return m ? m.index : 0;
  })();
  const head = buf.toString('latin1', 0, Math.max(headEnd, 256));
  const charset = detectCharset(head);
  return iconv.decode(buf, charset);
}

function extractTagValue(block: string, tag: string): string | null {
  // Match `<TAG>value` up to the next `<` or end-of-line. SGML-style: no
  // closing tag required, but tolerate one if present.
  const re = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i');
  const m = block.match(re);
  if (!m) return null;
  const v = (m[1] ?? '').trim();
  return v || null;
}

function parseOfxDate(s: string): string {
  // OFX dates: YYYYMMDD[HHMMSS[.SSS]][TZ]
  const ymd = s.slice(0, 8);
  if (!/^\d{8}$/.test(ymd)) {
    throw new Error(`invalid OFX date: ${JSON.stringify(s)}`);
  }
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function parseOfxAmount(s: string): string {
  // OFX uses a period as the decimal separator, but some French exporters
  // mistakenly emit a comma — accept both.
  const n = s.replace(',', '.').trim();
  if (!/^-?\d+(\.\d+)?$/.test(n)) {
    throw new Error(`invalid OFX amount: ${JSON.stringify(s)}`);
  }
  const v = Number(n);
  if (!Number.isFinite(v)) throw new Error(`non-finite OFX amount: ${s}`);
  return v.toFixed(2);
}

export function parseOfx(buf: Buffer): ParsedTransaction[] {
  const text = decodeOfxBuffer(buf);

  const out: ParsedTransaction[] = [];

  // <STMTTRN>…</STMTTRN> blocks DO have closing tags in practice (the spec
  // requires them); fields *inside* are the SGML-style unclosed tags.
  const blocks = text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi);
  for (const m of blocks) {
    const block = m[1] ?? '';
    const date = extractTagValue(block, 'DTPOSTED');
    const amount = extractTagValue(block, 'TRNAMT');
    if (!date || !amount) continue; // malformed block — skip
    const name = extractTagValue(block, 'NAME') ?? '';
    const memo = extractTagValue(block, 'MEMO');
    const fitid = extractTagValue(block, 'FITID');

    out.push({
      date: parseOfxDate(date),
      amount: parseOfxAmount(amount),
      rawLabel: memo && name ? `${name} ${memo}`.trim() : (name || memo || '').trim(),
      memo,
      fitid,
    });
  }

  return out;
}
