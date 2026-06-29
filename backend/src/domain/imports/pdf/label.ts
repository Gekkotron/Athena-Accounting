// OFX 2.0's NAME field is capped at 32 characters, so French banks truncate
// transaction labels mid-word ("CASTORAMA CARTE 7883 PAIEMENT MOB 0107 KINGERSH
// 1478/" becomes "CASTORAMA CARTE 7883 PAIEMENT MO" in the OFX export). PDF
// statements carry the full label across one or two lines. Mirroring the OFX
// cap on PDF rawLabels makes the dedup key collide cleanly between the two
// sources — without it, the same real-world transaction imported as both OFX
// and PDF would land twice.
export const OFX_NAME_LENGTH = 32;

export function truncateLabel(s: string, max = OFX_NAME_LENGTH): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd();
}
