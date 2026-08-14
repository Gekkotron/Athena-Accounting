export type FxRate = {
  fromCcy: string;
  toCcy: string;
  effectiveFrom: string; // ISO YYYY-MM-DD
  rate: string;          // stringified numeric to preserve precision
};

export type ConsolidatedTotals<K extends string> = {
  display: string;
  totals: Record<K, string>; // stringified numeric, 2-decimal quantized
  unmapped: Array<{ currency: string } & Record<K, string>>;
};
