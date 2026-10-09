import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  'aria-label': string;
  children: ReactNode;
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'secondary';
};

const SIZE: Record<'sm' | 'md', string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
};

const VARIANT: Record<'ghost' | 'secondary', string> = {
  ghost: 'text-ink-300 hover:bg-ink-900 hover:text-ink-100',
  secondary:
    'border border-ink-800 bg-ink-900/70 text-ink-100 hover:border-ink-700 hover:bg-ink-850',
};

// Square icon button. Replaces the `btn-ghost !min-h-0 !py-1.5 !px-2` incantation
// that proliferates across the app. `aria-label` is required at the type level —
// an icon with no accessible name is a bug.
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { children, size = 'md', variant = 'ghost', className = '', type = 'button', ...rest },
    ref,
  ) {
    const cls = `btn-icon ${SIZE[size]} ${VARIANT[variant]} ${className}`.trim();
    return (
      <button ref={ref} type={type} className={cls} {...rest}>
        {children}
      </button>
    );
  },
);
