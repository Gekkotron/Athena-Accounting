import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

const IDLE_MS = 5 * 60 * 1000; // 5 minutes
export const LOCK_FLAG_KEY = 'athena.locked';

export interface LockStatus {
  mode: 'session' | 'none';
  lockConfigured: boolean;
}

interface LockContextValue {
  locked: boolean;
  lockAvailable: boolean;
  lockNow: () => void;
  unlock: (password: string) => Promise<void>;
}

const LockCtx = createContext<LockContextValue | null>(null);

export function useLock() {
  const ctx = useContext(LockCtx);
  if (!ctx) throw new Error('useLock() used outside <LockProvider>');
  return ctx;
}

// Tracks user inactivity and, after IDLE_MS, locks the app behind a
// password prompt. The flag is mirrored to localStorage so an F5 or an app
// relaunch boots straight into the locked state — without that, a reload
// with the still-valid session cookie would bypass the lock entirely.
export function LockProvider({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(() => localStorage.getItem(LOCK_FLAG_KEY) === '1');
  const timerRef = useRef<number | null>(null);

  const status = useQuery({
    queryKey: ['lock-status'],
    queryFn: () => api<LockStatus>('/api/auth/lock-status'),
    staleTime: Infinity,
  });
  const lockAvailable = status.data?.lockConfigured ?? false;

  const engage = useCallback(() => {
    localStorage.setItem(LOCK_FLAG_KEY, '1');
    setLocked(true);
  }, []);

  useEffect(() => {
    // Mirror the React state onto <html> so global CSS hides amounts in the
    // layer beneath the overlay too.
    document.documentElement.classList.toggle('privacy-on', locked);
  }, [locked]);

  // Desktop recovery: if the lock password was reset out-of-band (curl),
  // lock-status reports unconfigured — a leftover flag must not brick the UI.
  useEffect(() => {
    if (locked && status.data && !status.data.lockConfigured) {
      localStorage.removeItem(LOCK_FLAG_KEY);
      setLocked(false);
    }
  }, [locked, status.data]);

  useEffect(() => {
    if (locked || !lockAvailable) return;

    const onActivity = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(engage, IDLE_MS);
    };

    const events: (keyof WindowEventMap)[] = [
      'mousemove', 'keydown', 'scroll', 'touchstart', 'click',
    ];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    onActivity(); // arm the timer immediately

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [locked, lockAvailable, engage]);

  const unlock = useCallback(async (password: string) => {
    await api<{ ok: boolean }>('/api/auth/verify', { method: 'POST', json: { password } });
    localStorage.removeItem(LOCK_FLAG_KEY);
    setLocked(false);
  }, []);

  const value = useMemo<LockContextValue>(
    () => ({ locked, lockAvailable, lockNow: engage, unlock }),
    [locked, lockAvailable, engage, unlock],
  );

  return <LockCtx.Provider value={value}>{children}</LockCtx.Provider>;
}
