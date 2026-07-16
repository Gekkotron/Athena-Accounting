import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTips } from '../contexts/TipsContext';
import { WELCOME_STEPS } from '../tips/content';

// First-launch modal shown once on the Dashboard ('/') for authenticated
// users who have not yet dismissed 'welcome_tour'. Passer, Terminer, Esc
// and backdrop click all call dismiss('welcome_tour') via TipsContext.
export function WelcomeTour(): JSX.Element | null {
  const { ready, isDismissed, dismiss } = useTips();
  const location = useLocation();
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  const shouldShow = ready && !isDismissed('welcome_tour') && location.pathname === '/';

  const close = useCallback(() => {
    dismiss('welcome_tour').catch(() => {
      // Optimistic update already applied; TipsContext rolls back on
      // failure and the modal simply reopens on the next render.
    });
  }, [dismiss]);

  useEffect(() => {
    if (!shouldShow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      // Focus trap: Tab from the last focusable element wraps to the
      // first, Shift+Tab from the first wraps to the last, so keyboard
      // focus never escapes to the underlying page while the tour is open.
      const focusables = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shouldShow, close]);

  // Capture the previously focused element on open and set initial focus
  // inside the dialog. On close (shouldShow flips false) or unmount, restore
  // focus to whatever was focused before the tour opened.
  useEffect(() => {
    if (!shouldShow) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previousActiveRef.current?.focus();
      previousActiveRef.current = null;
    };
  }, [shouldShow]);

  if (!shouldShow) return null;

  const current = WELCOME_STEPS[step];
  const isLast = step === WELCOME_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="presentation"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-tour-title"
        ref={dialogRef}
        tabIndex={-1}
        className="surface w-full max-w-md p-6 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="label mb-2">
          Étape {step + 1} / {WELCOME_STEPS.length}
        </div>
        <div id="welcome-tour-title" className="display text-xl text-ink-50 mb-2 leading-snug">
          {current.title}
        </div>
        <p className="text-sm text-ink-400 mb-6 leading-relaxed">{current.body}</p>
        <div className="flex items-center justify-between">
          <button type="button" className="btn-ghost" onClick={close}>
            Passer
          </button>
          {isLast ? (
            <button type="button" className="btn-primary" onClick={close}>
              Terminer
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => setStep((s) => s + 1)}>
              Suivant
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
