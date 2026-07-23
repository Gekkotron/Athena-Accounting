import type { NavIconName } from '../NavIcons';

export type NavChild = { to: string; labelKey: string; end?: boolean };
export type NavItem = {
  to: string;
  labelKey: string;
  end?: boolean;
  icon: NavIconName;
  children?: NavChild[];
};
export type NavSection = { titleKey: string; items: NavItem[] };

export const nav: NavSection[] = [
  {
    titleKey: 'nav.sections.daily',
    items: [
      { to: '/', labelKey: 'nav.items.dashboard', end: true, icon: 'dashboard' },
      { to: '/transactions', labelKey: 'nav.items.transactions', icon: 'transactions' },
      {
        to: '/budgets',
        labelKey: 'nav.items.budgets',
        icon: 'budgets',
        children: [
          { to: '/budgets/caps', labelKey: 'nav.children.budgets.plafonds' },
          { to: '/budgets/envelopes', labelKey: 'nav.children.budgets.enveloppes' },
        ],
      },
    ],
  },
  {
    titleKey: 'nav.sections.classification',
    items: [
      {
        to: '/rules',
        labelKey: 'nav.items.rules',
        icon: 'rules',
        children: [
          { to: '/rules/sort', labelKey: 'nav.children.rules.sort' },
          { to: '/rules/list', labelKey: 'nav.children.rules.list' },
          { to: '/rules/categories', labelKey: 'nav.children.rules.categories' },
        ],
      },
      {
        to: '/recurring',
        labelKey: 'nav.items.recurrent',
        icon: 'recurrent',
        children: [
          { to: '/recurring/detected', labelKey: 'nav.children.recurrent.detected' },
          { to: '/recurring/upcoming', labelKey: 'nav.children.recurrent.upcoming' },
          { to: '/recurring/forecast', labelKey: 'nav.children.recurrent.forecast' },
        ],
      },
    ],
  },
  {
    titleKey: 'nav.sections.structure',
    items: [
      {
        to: '/accounts',
        labelKey: 'nav.items.accounts',
        end: true,
        icon: 'accounts',
      },
      {
        to: '/data',
        labelKey: 'nav.items.data',
        icon: 'imports',
        children: [
          { to: '/data/imports', labelKey: 'nav.children.data.imports' },
          { to: '/data/duplicates', labelKey: 'nav.children.data.duplicates' },
          { to: '/data/pdf-templates', labelKey: 'nav.children.data.pdfTemplates' },
          { to: '/data/backup', labelKey: 'nav.children.data.backup' },
        ],
      },
    ],
  },
];

export const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `relative rounded-lg px-3 py-2 text-sm transition flex items-center gap-3 ${
    isActive
      ? 'text-ink-50 bg-ink-850'
      : 'text-ink-400 hover:text-ink-100 hover:bg-ink-900/70'
  }`;
