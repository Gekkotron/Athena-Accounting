import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNavBadgeCounts } from '../lib/useNavBadgeCounts';

export type HubTab = { to: string; label: string; end?: boolean };

// Tabs mirror the left-nav badge for the same route (see useNavBadgeCounts)
// so the "attention needed" count on the collapsed hub entry is repeated on
// the sub-tab that actually holds the work — the user can spot the affected
// tab without clicking through each one.
export function HubLayout({ title, tabs }: { title: string; tabs: HubTab[] }) {
  const { t } = useTranslation('layout');
  const badges = useNavBadgeCounts();
  return (
    <div className="flex flex-col gap-6">
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
      </div>
      <nav
        aria-label={t('subNav.ariaLabel', { title })}
        className="flex flex-wrap gap-1 border-b border-ink-800/70"
      >
        {tabs.map((tab) => {
          const badge = badges[tab.to] ?? 0;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `-mb-px px-3 py-2 text-sm border-b-2 transition inline-flex items-center gap-2 ${
                  isActive
                    ? 'text-ink-50 border-sage-300'
                    : 'text-ink-400 border-transparent hover:text-ink-100'
                }`
              }
            >
              <span>{tab.label}</span>
              {badge > 0 && (
                <span
                  aria-label={t('nav.badge', { count: badge })}
                  className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-clay-500/25 text-clay-200 text-[10px] font-mono leading-none"
                >
                  {badge}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
