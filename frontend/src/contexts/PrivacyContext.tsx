import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const IDLE_MS = 5 * 60 * 1000; // 5 minutes

interface PrivacyContextValue {
  hidden: boolean;
  reveal: () => void;
  hideNow: () => void;
  toggle: () => void;
}

const PrivacyCtx = createContext<PrivacyContextValue | null>(null);

export function usePrivacy() {
  const ctx = useContext(PrivacyCtx);
  if (!ctx) throw new Error('usePrivacy() used outside <PrivacyProvider>');
  return ctx;
}

// Tracks user inactivity and, after IDLE_MS, hides all on-screen amounts (via
// a class on <html>). Activity DOES NOT auto-reveal — once hidden, the user
// must explicitly tap the eye toggle. That's the whole privacy point: if a
// stray mouse-move uncovered the screen, the timeout would be meaningless.
export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Mirror the React state onto <html> so global CSS can react.
    document.documentElement.classList.toggle('privacy-on', hidden);
  }, [hidden]);

  useEffect(() => {
    if (hidden) return; // freeze tracking while hidden

    const onActivity = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setHidden(true), IDLE_MS);
    };

    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
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
  }, [hidden]);

  const value: PrivacyContextValue = {
    hidden,
    reveal: () => setHidden(false),
    hideNow: () => setHidden(true),
    toggle: () => setHidden((h) => !h),
  };

  return <PrivacyCtx.Provider value={value}>{children}</PrivacyCtx.Provider>;
}
