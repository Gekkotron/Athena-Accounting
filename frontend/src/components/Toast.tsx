import { createContext, useCallback, useContext, useState } from 'react';

type ToastItem = { id: number; title: string; body: string };

const AUTO_DISMISS_MS = 5000;

const ToastContext = createContext<{ push: (t: Omit<ToastItem, 'id'>) => void } | null>(null);

// Minimal in-app transient notification host. Mounted once inside the
// authenticated tree (App.tsx); channel adapters stay hook-free by calling
// the `push` function they're handed rather than `useToast()` themselves.
export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className="max-w-sm rounded-lg border border-ink-700 bg-ink-800 p-3 text-ink-100 shadow-lg"
          >
            <div className="font-medium">{t.title}</div>
            <div className="text-sm text-ink-300">{t.body}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): { push: (t: Omit<ToastItem, 'id'>) => void } {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast requires <ToastProvider>');
  return ctx;
}
