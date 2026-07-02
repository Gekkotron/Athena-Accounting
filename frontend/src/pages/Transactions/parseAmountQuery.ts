// Try to interpret a search input as an amount. Accepts "338", "338€",
// "338,50", "338.50", "338,50 €", with optional leading minus. Returns the
// canonical "X.XX" form, or null when it's not a number.
export function parseAmountQuery(raw: string): string | null {
  const cleaned = raw
    .replace(/€/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .trim();
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}
