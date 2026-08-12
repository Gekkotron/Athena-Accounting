import { useEffect, useState } from 'react';

// Tracks the browser's `navigator.onLine` state, updated live via the
// window `online`/`offline` events. Returns `true` in non-DOM contexts so
// server-side renders and jsdom stubs default to "assume connected".
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return online;
}
