// Inline SVG icons for the sidebar nav. Stroke-based monoline, 16×16, all
// rendered with currentColor so the NavLink active-state colour propagates
// from the parent. Kept here (not in a generic Icon set) because they're
// purpose-built for these specific routes and small enough to be inlined.

type IconProps = { className?: string; size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
});

export function IconDashboard({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

export function IconTransactions({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 5h9M12 5l-2-2M12 5l-2 2" />
      <path d="M13 11H4M4 11l2-2M4 11l2 2" />
    </svg>
  );
}

export function IconTri({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 3v10M4 13l-2-2M4 13l2-2" />
      <path d="M8 4h6M8 8h4M8 12h2" />
    </svg>
  );
}

export function IconCategories({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M7.5 2 L13 2 L13 7.5 L7.5 13 L2 7.5 L7.5 2 Z" />
      <circle cx="10.5" cy="5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconRules({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5.5 3 Q3 3, 3 5 V7 Q3 8, 1.8 8 Q3 8, 3 9 V11 Q3 13, 5.5 13" />
      <path d="M10.5 3 Q13 3, 13 5 V7 Q13 8, 14.2 8 Q13 8, 13 9 V11 Q13 13, 10.5 13" />
    </svg>
  );
}

export function IconAccounts({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="4" width="12" height="9" rx="1.5" />
      <path d="M2 7.5h12" />
      <circle cx="11" cy="10.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconImports({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 2v7M8 9l-2.5-2.5M8 9l2.5-2.5" />
      <path d="M2.5 11v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V11" />
    </svg>
  );
}

export const navIcons = {
  dashboard: IconDashboard,
  transactions: IconTransactions,
  tri: IconTri,
  categories: IconCategories,
  rules: IconRules,
  accounts: IconAccounts,
  imports: IconImports,
} as const;
export type NavIconName = keyof typeof navIcons;
