export function parseFrenchDate(s: string): string {
  const m = s.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/);
  if (!m) throw new Error(`invalid French date: ${JSON.stringify(s)}`);
  let [, d, mo, y] = m;
  const day = Number(d), month = Number(mo);
  if (month < 1 || month > 12) throw new Error(`invalid French date: ${JSON.stringify(s)}`);
  if (day < 1 || day > 31) throw new Error(`invalid French date: ${JSON.stringify(s)}`);
  if (y!.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
  return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
}

export function tryParseFrenchDate(s: string): string | null {
  try { return parseFrenchDate(s); } catch { return null; }
}

export function parseFrenchAmount(s: string): string {
  if (!s || !s.trim()) return '';
  let v = s.replace(/[€$\s ]/g, '').trim();
  v = v.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(v)) {
    throw new Error(`invalid amount: ${JSON.stringify(s)}`);
  }
  return Number(v).toFixed(2);
}

export function tryParseFrenchAmount(s: string): string | null {
  try {
    const r = parseFrenchAmount(s);
    return r === '' ? null : r;
  } catch { return null; }
}

// Detect the decimal separator per value, so a mixed-locale CSV file
// doesn't corrupt period-decimal amounts (e.g. "-950.00" was previously
// 100×-ed by parseFrenchAmount stripping the dot as a thousands separator).
//
// Rules:
//   - both `.` and `,`: the last one is the decimal separator
//     ("1,234.56" → 1234.56;  "1.234,56" → 1234.56).
//   - only `.` or only `,`: if there's exactly one and it's followed by
//     1 or 2 digits, treat as decimal separator; otherwise thousands.
//   - neither: pure integer.
export function parseAmountAuto(s: string): string {
  if (!s || !s.trim()) return '';
  let v = s.replace(/[€$\s ]/g, '').trim();

  const hasDot = v.includes('.');
  const hasComma = v.includes(',');

  if (hasDot && hasComma) {
    if (v.lastIndexOf('.') > v.lastIndexOf(',')) {
      v = v.replace(/,/g, '');           // US: 1,234.56
    } else {
      v = v.replace(/\./g, '').replace(',', '.');  // FR: 1.234,56
    }
  } else if (hasDot) {
    const parts = v.split('.');
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1]!)) {
      // "950.00" — decimal point, leave untouched.
    } else if (parts.slice(1).every((p) => /^\d{3}$/.test(p))) {
      v = v.replace(/\./g, '');  // e.g. 12.345.678 → 12345678
    } else {
      throw new Error(`invalid amount: ${JSON.stringify(s)}`);
    }
  } else if (hasComma) {
    const parts = v.split(',');
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1]!)) {
      v = v.replace(',', '.');           // FR: 950,00
    } else if (parts.slice(1).every((p) => /^\d{3}$/.test(p))) {
      v = v.replace(/,/g, '');
    } else {
      throw new Error(`invalid amount: ${JSON.stringify(s)}`);
    }
  }

  if (!/^-?\d+(\.\d+)?$/.test(v)) {
    throw new Error(`invalid amount: ${JSON.stringify(s)}`);
  }
  return Number(v).toFixed(2);
}
