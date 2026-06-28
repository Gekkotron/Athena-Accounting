interface Props {
  size?: number;
  className?: string;
}

// Athena's chouette (Athene noctua) — modelled after the silhouette on
// ancient Athenian tetradrachm coins (γλαῦξ): squat body, oversized
// forward-facing eyes, small triangular beak, no ear tufts (that would be
// a `hibou`, the wrong genus).
//
// Drawn as an outlined silhouette with filled facial features so the mark
// adapts to any background colour via currentColor.
export function Logo({ size = 28, className = '' }: Props) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
    >
      {/* Body silhouette — head merges into a tapered torso, like the
          tetradrachm engraving. */}
      <path
        d="M 16 3
           C 21.5 3, 24 6.5, 23 11
           C 25 15, 25 21, 22 25.5
           Q 22 27.5, 20 27.5
           L 12 27.5
           Q 10 27.5, 10 25.5
           C 7 21, 7 15, 9 11
           C 8 6.5, 10.5 3, 16 3 Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Two oversized forward-facing eyes — the hallmark of Athena's owl */}
      <circle cx="12.5" cy="11" r="2" fill="currentColor" />
      <circle cx="19.5" cy="11" r="2" fill="currentColor" />

      {/* Small triangular beak between/below the eyes */}
      <path d="M 14.5 14.5 L 17.5 14.5 L 16 17 Z" fill="currentColor" />

      {/* Subtle feather V on the chest — a nod to the engraved plumage on
          the coins, without adding visual weight at favicon sizes. */}
      <path
        d="M 13 20 L 16 22.5 L 19 20"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
    </svg>
  );
}
