interface Props {
  size?: number;
  className?: string;
}

// Athena Accounting monogram. A geometric capital "A" with asymmetric stroke
// weights — thin left, thick right, slim crossbar — borrowing the
// high-contrast personality of Fraunces (the serif used in the wordmark).
// The triangular silhouette also reads as a Greek temple pediment without
// resorting to a literal column or mythological character.
// All strokes use currentColor so the caller controls tint via Tailwind.
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
      {/* Left stroke — thinner, to mimic the inner contrast of a serif */}
      <path
        d="M 8.5 26 L 16 5.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right stroke — thicker, the dominant axis */}
      <path
        d="M 16 5.5 L 23.5 26"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Crossbar — slim, modernist */}
      <path
        d="M 12 19 L 20 19"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
