import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Node 25 ships an experimental global `localStorage` that lacks the
// standard Storage methods and shadows jsdom's Storage impl. Replace it
// with a minimal in-memory Storage so tests and hooks (usePersistedState)
// see the standard API regardless of runtime.
{
  const store = new Map<string, string>();
  const impl = {
    get length() { return store.size; },
    key(i: number) { return Array.from(store.keys())[i] ?? null; },
    getItem(k: string) { return store.has(k) ? (store.get(k) as string) : null; },
    setItem(k: string, v: string) { store.set(k, String(v)); },
    removeItem(k: string) { store.delete(k); },
    clear() { store.clear(); },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true, writable: true });
  Object.defineProperty(window, 'localStorage', { value: impl, configurable: true, writable: true });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
