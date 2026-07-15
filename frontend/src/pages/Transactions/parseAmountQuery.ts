// Try to interpret a search input as an amount. Accepts "338", "338€",
// "338,50", "338.50", "338,50 €", with optional leading minus. Returns the
// canonical "X.XX" form, or null when it's not a number. Thin alias over
// `parseDecimal` — same rules apply, this name marks the search-bar caller.
export { parseDecimal as parseAmountQuery } from '../../lib/format';
