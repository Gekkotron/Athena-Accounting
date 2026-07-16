import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/client';
import type { TipId } from '../tips/content';

interface TipsContextValue {
  dismissed: Record<string, string>;
  isDismissed: (id: TipId) => boolean;
  dismiss: (id: TipId) => Promise<void>;
  undismiss: (id: TipId) => Promise<void>;
  reset: () => Promise<void>;
  ready: boolean;
}

const TipsCtx = createContext<TipsContextValue | null>(null);

export function useTips(): TipsContextValue {
  const ctx = useContext(TipsCtx);
  if (!ctx) throw new Error('useTips() must be used inside <TipsProvider>');
  return ctx;
}

// Fails closed on network errors: if hydration errors we still set ready
// to true with dismissed={}, so the UI does not stall on a broken
// endpoint. The next mutation will attempt to re-sync via its own POST.
export function TipsProvider({ children }: { children: ReactNode }) {
  const [dismissed, setDismissed] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ dismissed: Record<string, string> }>('/api/tips/dismissed');
        if (!cancelled) setDismissed(res.dismissed ?? {});
      } catch {
        // Fail closed — see comment above.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(async (id: TipId) => {
    const prev = dismissed;
    setDismissed({ ...prev, [id]: new Date().toISOString() });
    try {
      await api('/api/tips/dismiss', { method: 'POST', json: { id } });
    } catch (err) {
      setDismissed(prev);
      throw err;
    }
  }, [dismissed]);

  const undismiss = useCallback(async (id: TipId) => {
    const prev = dismissed;
    const next = { ...prev };
    delete next[id];
    setDismissed(next);
    try {
      await api('/api/tips/undismiss', { method: 'POST', json: { id } });
    } catch (err) {
      setDismissed(prev);
      throw err;
    }
  }, [dismissed]);

  const reset = useCallback(async () => {
    const prev = dismissed;
    setDismissed({});
    try {
      await api('/api/tips/reset', { method: 'POST' });
    } catch (err) {
      setDismissed(prev);
      throw err;
    }
  }, [dismissed]);

  const value = useMemo<TipsContextValue>(
    () => ({
      dismissed,
      isDismissed: (id) => id in dismissed,
      dismiss,
      undismiss,
      reset,
      ready,
    }),
    [dismissed, ready, dismiss, undismiss, reset],
  );

  return <TipsCtx.Provider value={value}>{children}</TipsCtx.Provider>;
}
