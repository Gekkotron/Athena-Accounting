import type { ReactNode } from 'react';

// Top-of-section thin separator with a small-caps label. The visual belongs to
// the `.section-rule` component class in index.css (`flex items-center gap-3`
// + text styling + a trailing `::after` hairline). This primitive just owns
// the magic class so callers stop repeating it, and forwards an optional
// className for callers that stack layout utilities on top (`mb-4`, `flex-1`,
// `justify-between`, etc. — the compiled utility layer wins over the
// component class, which is why `items-baseline` can override the default
// `items-center` from a caller).
export function SectionRule({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const cls = `section-rule ${className}`.trimEnd();
  return <div className={cls}>{children}</div>;
}
