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

export function IconBudgets({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6.5h12" />
      <path d="M5 9.5h3" />
    </svg>
  );
}

export function IconRecurrent({ className, size = 16 }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 8a4 4 0 0 1 7-2.6" />
      <path d="M11 3v2.4h-2.4" />
      <path d="M12 8a4 4 0 0 1-7 2.6" />
      <path d="M5 13v-2.4h2.4" />
    </svg>
  );
}

export function IconGoals({ className, size = 16 }: IconProps) {
  // Piggy-bank line art — a single body (ellipse) with an ear, a snout dot,
  // a coin slot on top, and two stubby legs. Same stroke weight as the rest
  // of the set so it doesn't stand out visually.
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 8.5c0-2 2-3.5 5-3.5 3 0 5 1.5 5 3.5 0 1.5-1 2.7-2.5 3.2V13h-1.2v-1.2h-2.6V13H5V11.7C3.5 11.2 2.5 10 2.5 8.5Z" />
      <path d="M12 6.5c.8-.3 1.6-.3 2 0-.2.4-.5.7-.8.9" />
      <circle cx="9.5" cy="8" r="0.35" fill="currentColor" stroke="none" />
      <path d="M6 6.5L7.8 6" />
    </svg>
  );
}

export const navIcons = {
  dashboard: IconDashboard,
  transactions: IconTransactions,
  budgets: IconBudgets,
  rules: IconRules,
  accounts: IconAccounts,
  imports: IconImports,
  recurrent: IconRecurrent,
  goals: IconGoals,
} as const;
export type NavIconName = keyof typeof navIcons;
