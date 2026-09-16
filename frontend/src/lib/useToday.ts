import { useEffect, useState } from 'react';
import { todayLocalIso } from './dates';

// The user's local calendar day, reactive. Long-lived tabs open across
// midnight otherwise capture a stale "today" in useMemo initialisers and
// keep rendering yesterday's window. We poll once a minute (cheap) and
// also on tab focus so a laptop unsuspended after midnight snaps forward
// immediately.
export function useToday(): string {
  const [today, setToday] = useState<string>(() => todayLocalIso());
  useEffect(() => {
    const check = () => {
      const now = todayLocalIso();
      setToday((prev) => (prev === now ? prev : now));
    };
    const iv = setInterval(check, 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return today;
}
