import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export type HubTab = { to: string; label: string; end?: boolean };

export function HubLayout({ title, tabs }: { title: string; tabs: HubTab[] }) {
  const { t } = useTranslation('layout');
  return (
    <div className="flex flex-col gap-6">
      <div className="page-header">
        <h1 className="page-title">{title}</h1>
      </div>
      <nav
        aria-label={t('subNav.ariaLabel', { title })}
        className="flex flex-wrap gap-1 border-b border-ink-800/70"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `-mb-px px-3 py-2 text-sm border-b-2 transition ${
                isActive
                  ? 'text-ink-50 border-sage-300'
                  : 'text-ink-400 border-transparent hover:text-ink-100'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
