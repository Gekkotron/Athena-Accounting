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

// jsdom 25 does not implement PointerEvent, so `fireEvent.pointerDown` from
// Testing Library silently degrades and never actually fires the DOM event.
// Provide a minimal ctor that extends MouseEvent and carries `pointerType`
// + `pointerId` — enough for React's onPointerDown/onPointerMove/onPointerUp
// handlers to see the fields they need.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'PointerEvent', { value: PointerEventPolyfill, configurable: true, writable: true });
}

// jsdom Elements have no setPointerCapture / releasePointerCapture — stub them
// out as noops so components that call them don't throw in tests.
if (typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = function () {};
}
if (typeof Element.prototype.releasePointerCapture !== 'function') {
  Element.prototype.releasePointerCapture = function () {};
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
