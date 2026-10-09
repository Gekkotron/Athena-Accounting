import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ShortcutsCtx {
  open: () => void;
}

const Ctx = createContext<ShortcutsCtx>({ open: () => {} });

export function useShortcuts(): ShortcutsCtx {
  return useContext(Ctx);
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

// Global `?` opens a modal listing every shortcut the app binds. Inert while
// the user is typing in a form control; ignored when combined with a modifier
// so native browser shortcuts (Cmd+?, Ctrl+?) stay untouched.
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== '?') return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Ctx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      {open && <Sheet onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  );
}

interface Row {
  keys: string[];
  labelKey: string;
}

const TX_ROWS: Row[] = [
  { keys: ['j'], labelKey: 'shortcuts.items.nextRow' },
  { keys: ['k'], labelKey: 'shortcuts.items.prevRow' },
  { keys: ['e'], labelKey: 'shortcuts.items.edit' },
  { keys: ['d'], labelKey: 'shortcuts.items.delete' },
  { keys: ['/'], labelKey: 'shortcuts.items.focusSearch' },
];

const GLOBAL_ROWS: Row[] = [
  { keys: ['?'], labelKey: 'shortcuts.items.openSheet' },
  { keys: ['Esc'], labelKey: 'shortcuts.items.closeDialog' },
];

function Sheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcuts.title')}
      onClick={onClose}
    >
      <div className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="display text-xl text-ink-50 mb-5 leading-snug">{t('shortcuts.title')}</div>

        <Group title={t('shortcuts.groups.transactions')} rows={TX_ROWS} t={t} />
        <div className="h-4" />
        <Group title={t('shortcuts.groups.global')} rows={GLOBAL_ROWS} t={t} />

        <div className="mt-6 text-[11px] text-ink-500">{t('shortcuts.footerHint')}</div>

        <div className="flex justify-end mt-5">
          <button className="btn-ghost" onClick={onClose} autoFocus>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Group({
  title,
  rows,
  t,
}: {
  title: string;
  rows: Row[];
  t: (k: string) => string;
}) {
  return (
    <div>
      <div className="section-rule mb-2">{title}</div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li
            key={r.keys.join('+') + r.labelKey}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-ink-200">{t(r.labelKey)}</span>
            <span className="flex items-center gap-1">
              {r.keys.map((k) => (
                <kbd
                  key={k}
                  className="inline-flex items-center justify-center min-w-[1.6rem] h-6 px-1.5 rounded-md border border-ink-700 bg-ink-900 text-[11px] font-mono text-ink-100"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
