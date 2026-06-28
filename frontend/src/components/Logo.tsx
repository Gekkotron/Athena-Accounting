interface Props {
  size?: number;
  className?: string;
}

// Athena's owl, geometric and symmetric — two round eyes + a small beak.
// Uses currentColor for stroke/fill so callers can colour it with Tailwind
// (e.g. text-sage-300, text-ink-100, …) without prop drilling colour values.
export function Logo({ size = 28, className = '' }: Props) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="11.5" cy="14" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="11.5" cy="14" r="2" fill="currentColor" />

      <circle cx="20.5" cy="14" r="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="20.5" cy="14" r="2" fill="currentColor" />

      <path d="M14 21.5 L18 21.5 L16 24.5 Z" fill="currentColor" />
    </svg>
  );
}
