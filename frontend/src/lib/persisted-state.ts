import { useEffect, useRef, useState } from 'react';

// Same signature as useState, but the value is mirrored into localStorage
// under `key`. On mount, the initial value comes from localStorage if
// present; otherwise `initial` (or the return of `initial()` if a factory)
// is used. Writes are best-effort — a full disk or a Safari private-mode
// session that blocks localStorage falls back to in-memory state without
// throwing.
export function usePersistedState<T>(
  key: string,
  initial: T | (() => T),
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // fall through to initial
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  // Ref so the effect can read the latest key without re-writing when only
  // the state changes.
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    try {
      window.localStorage.setItem(keyRef.current, JSON.stringify(value));
    } catch {
      // localStorage full / unavailable — ignore.
    }
  }, [value]);

  return [value, setValue];
}
