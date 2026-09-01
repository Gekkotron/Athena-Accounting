import { useEffect, useState } from 'react';
import { useSettings } from '../../lib/useSettings';
import type { Settings as SettingsShape } from '../../lib/settings';

// Shared PATCH-and-flash helper for the settings sub-pages: reuses the same
// useSettings() mutation, keeps a per-field "just saved" chip visible for
// 1500 ms, and clears it on error. Extracted so Dashboard / Transactions /
// Import don't duplicate the same 15 lines.
export function useSettingsFlash() {
  const s = useSettings();
  const [flashKey, setFlashKey] = useState<keyof SettingsShape | null>(null);

  useEffect(() => {
    if (s.mutation.isSuccess) {
      const timer = setTimeout(() => setFlashKey(null), 1500);
      return () => clearTimeout(timer);
    }
    if (s.mutation.isError) setFlashKey(null);
  }, [s.mutation.isSuccess, s.mutation.isError, s.mutation.data]);

  const send = <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) => {
    if (s.settings[key] === value) return;
    setFlashKey(key);
    s.patch({ [key]: value } as Partial<SettingsShape>);
  };

  return { ...s, flashKey, send };
}
