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
