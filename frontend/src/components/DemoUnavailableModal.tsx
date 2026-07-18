import { useEffect, useState } from 'react';

// Global "not available in demo" modal. Any code that catches an
// ApiError with { demoStub: true } can dispatch the event below and
// this modal will pop up; the affected pages therefore don't need to
// import the component, they just fire the event. Cheap wiring in
// pages of the app that never see the demo bundle at runtime.
//
// Event name: 'demo:show-unavailable'. Payload: { feature?: string }.

const EVENT = 'demo:show-unavailable';

export function showDemoUnavailable(feature?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { feature } }));
}

export function DemoUnavailableModal() {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<string | null>(null);

  useEffect(() => {
    const onShow = (e: Event) => {
      const detail = (e as CustomEvent<{ feature?: string }>).detail;
      setFeature(detail?.feature ?? null);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener(EVENT, onShow);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(EVENT, onShow);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-ink-950/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={() => setOpen(false)}
    >
      <div className="surface w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="display text-xl text-ink-50 mb-2 leading-snug">
          Non disponible dans la démo
        </div>
        <div className="text-sm text-ink-400 mb-5 leading-relaxed">
          {feature ? `${feature} n'est pas disponible dans la démo.` : "Cette fonctionnalité n'est pas disponible dans la démo."}{' '}
          Installez Athena sur votre machine pour l'utiliser — la démo ne
          garde rien côté serveur, elle vit dans votre navigateur.
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setOpen(false)}>Fermer</button>
          <a
            className="btn-primary"
            href="https://gekkotron.github.io/Athena-Accounting/docs/users/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            Comment installer
          </a>
        </div>
      </div>
    </div>
  );
}
