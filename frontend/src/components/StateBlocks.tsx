import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isDemoStubError } from '../api/errorMessage';

// Shared state primitives. Every page state (empty / loading / error) should
// route through one of these — reusing existing ink/sage/clay tokens — so no
// screen ever shows a bare skeleton block or a raw `error.message` dropped
// straight into the layout.

type SizeVariant = 'card' | 'inline';

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  return '';
}

interface EmptyStateProps {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  variant?: SizeVariant;
}

export function EmptyState({ title, hint, action, icon, variant = 'card' }: EmptyStateProps): JSX.Element {
  const wrap =
    variant === 'card'
      ? 'surface-soft flex flex-col items-center justify-center gap-3 px-6 py-10 text-center'
      : 'flex flex-col items-center justify-center gap-2 px-4 py-6 text-center';
  return (
    <div className={wrap}>
      {icon && <div className="text-ink-500">{icon}</div>}
      <div className="display text-lg text-ink-100">{title}</div>
      {hint && <div className="text-sm text-ink-400 max-w-md">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  retryLabel?: string;
  variant?: SizeVariant;
}

export function ErrorState({
  title,
  error,
  onRetry,
  retryLabel,
  variant = 'card',
}: ErrorStateProps): JSX.Element {
  const { t } = useTranslation('common');
  // In the browser-only demo, backend-only endpoints fail with a
  // demoStub / demoMissingHandler ApiError. Every call site already
  // routes through ErrorState, so absorbing the demo case here means
  // pages don't have to opt in one at a time.
  if (isDemoStubError(error)) {
    return <DemoUnavailableState variant={variant} />;
  }
  const wrap =
    variant === 'card'
      ? 'rounded-2xl border border-clay-700/60 bg-clay-900/20 px-6 py-8 text-center'
      : 'rounded-lg border border-clay-700/60 bg-clay-900/20 px-4 py-4 text-center';
  const detail = toMessage(error);
  return (
    <div className={wrap} role="alert">
      <div className="display text-lg text-clay-200">{title ?? t('error')}</div>
      {detail && (
        <div className="mt-1 text-sm text-clay-300 break-words max-w-md mx-auto">{detail}</div>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn-secondary mt-3 text-xs"
        >
          {retryLabel ?? t('retry')}
        </button>
      )}
    </div>
  );
}

interface DemoUnavailableStateProps {
  title?: string;
  hint?: ReactNode;
  variant?: SizeVariant;
}

// "Not available in the demo" state — same visual weight as EmptyState so
// pages that can't run in the browser-only demo don't look broken, just
// intentionally disabled. Use for feature areas that need a real backend
// (imports, PDF templates, duplicates panel, MCP tokens, …).
export function DemoUnavailableState({
  title,
  hint,
  variant = 'card',
}: DemoUnavailableStateProps): JSX.Element {
  const wrap =
    variant === 'card'
      ? 'surface-soft flex flex-col items-center justify-center gap-3 px-6 py-10 text-center'
      : 'flex flex-col items-center justify-center gap-2 px-4 py-6 text-center';
  return (
    <div className={wrap}>
      <div className="text-xs uppercase tracking-[0.2em] text-sage-300/80">Démo</div>
      <div className="display text-lg text-ink-100">
        {title ?? 'Non disponible dans la démo'}
      </div>
      <div className="text-sm text-ink-400 max-w-md">
        {hint ??
          "Cette section a besoin du back-end Athena pour fonctionner. Installez Athena localement pour l'utiliser."}
      </div>
      <a
        href="https://gekkotron.github.io/Athena-Accounting/docs/users/getting-started"
        className="btn-secondary mt-1 text-xs"
        target="_blank"
        rel="noopener noreferrer"
      >
        Comment installer
      </a>
    </div>
  );
}

interface LoadingBlockProps {
  label?: string;
  height?: string;
  variant?: SizeVariant;
}

// A neutral skeleton block. Uses `min-height` (not fixed) so callers can size
// it to match the eventual content and avoid layout shift on hydration.
export function LoadingBlock({ label, height = 'min-h-32', variant = 'card' }: LoadingBlockProps): JSX.Element {
  const { t } = useTranslation('common');
  const base =
    variant === 'card'
      ? `surface-soft ${height} flex items-center justify-center animate-pulse`
      : `rounded-lg bg-ink-900/40 ${height} flex items-center justify-center animate-pulse`;
  return (
    <div className={base} aria-busy="true" aria-live="polite">
      <span className="text-[10px] uppercase tracking-[0.18em] text-ink-500">
        {label ?? t('loading')}
      </span>
    </div>
  );
}
