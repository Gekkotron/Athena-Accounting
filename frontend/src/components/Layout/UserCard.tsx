import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { User } from '../../api/types';
import { useLock } from '../../contexts/LockContext';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';

function EyeClosedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1.5 7C2.7 4.5 4.7 3 7 3s4.3 1.5 5.5 4c-1.2 2.5-3.2 4-5.5 4S2.7 9.5 1.5 7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M1.5 1.5l11 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M1.5 3.5h7M11 3.5h1.5M1.5 7h2.5M6.5 7h6M1.5 10.5h7M11 10.5h1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="9.75" cy="3.5" r="1.1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="5.25" cy="7" r="1.1" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <circle cx="9.75" cy="10.5" r="1.1" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

export function UserCard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { t } = useTranslation('layout');
  const lock = useLock();
  return (
    <div className="mt-auto pt-6 border-t border-ink-800/60">
      <div className="flex items-center justify-between mb-1">
        <div className="label">{t('header.connectedAs')}</div>
        <LanguageSwitcher />
      </div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <NavLink
          to="/profile"
          className={({ isActive }) =>
            `block text-sm truncate font-medium underline-offset-2 hover:underline flex-1 min-w-0 ${
              isActive ? 'text-sage-300' : 'text-ink-100 hover:text-ink-50'
            }`
          }
          title={t('user.editProfile')}
        >
          {user.username}
        </NavLink>
        <NavLink
          to="/settings"
          title={t('user.settings')}
          aria-label={t('user.settings')}
          className={({ isActive }) =>
            `btn-ghost !min-h-0 !py-1 !px-1.5 shrink-0 ${
              isActive ? 'text-sage-300' : 'text-ink-400 hover:text-ink-100'
            }`
          }
        >
          <SlidersIcon />
        </NavLink>
      </div>
      {lock.lockAvailable && (
        <button
          className="btn-ghost w-full justify-start text-xs mb-1"
          onClick={lock.lockNow}
          title={t('user.lock.title')}
        >
          <EyeClosedIcon />
          {t('user.lock.button')}
        </button>
      )}
      <button className="btn-ghost w-full justify-start text-xs" onClick={onLogout}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2M9 9l3-2-3-2M12 7H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('user.logout')}
      </button>
    </div>
  );
}
