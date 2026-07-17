import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// A styled replacement for window.confirm — backdrop blur, surface card,
// Esc cancels, Enter confirms. The destructive variant uses the clay danger
// style for the confirm button.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  const resolvedConfirmLabel = confirmLabel ?? t('confirm');
  const resolvedCancelLabel = cancelLabel ?? t('cancel');
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!busy) onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="display text-xl text-ink-50 mb-2 leading-snug">{title}</div>
        {description && <div className="text-sm text-ink-400 mb-5 leading-relaxed">{description}</div>}
        {error && (
          <div className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200 mb-4">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onCancel} disabled={busy}>
            {resolvedCancelLabel}
          </button>
          <button
            className={destructive ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? '…' : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
