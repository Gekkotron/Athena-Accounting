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

// Content-shaped skeletons. These replace LoadingBlock at the specific
// surfaces where a shape-matched placeholder removes the layout shift and
// reads less like "something is broken" than the generic grey box.
//
// Every skeleton below:
//   - uses `animate-pulse` so the visual rhythm matches LoadingBlock,
//   - carries `aria-busy="true" aria-live="polite"` so screen readers hear
//     a single loading announcement regardless of how many bars/tiles the
//     placeholder renders.

// Fake 8-column bar chart on a baseline. Heights are seeded (not random)
// so the shape is identical across renders — avoids pointless re-paints
// and keeps visual regression stable. The real BalanceChart is a line, but
// readers universally recognise column outlines as "chart loading" and
// the alternative (sparse-dots-on-a-baseline) looks like a bug.
const CHART_SKELETON_HEIGHTS = [40, 65, 50, 80, 55, 70, 45, 90] as const;

export function ChartSkeleton({ height = 'min-h-40' }: { height?: string } = {}): JSX.Element {
  return (
    <div
      className={`surface-soft ${height} relative overflow-hidden animate-pulse`}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="absolute inset-0 flex items-end justify-around gap-2 px-4 pb-4 pt-4">
        {CHART_SKELETON_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm bg-ink-800/70"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      {/* baseline */}
      <div className="absolute left-4 right-4 bottom-3 h-px bg-ink-800" />
    </div>
  );
}

// n StatWidget-shaped tiles in a responsive grid. Matches the Moyennes
// mensuelles layout (1/2/3 columns on sm/lg) so the handoff to real
// StatWidgets is a no-shift swap.
export function StatGridSkeleton({ n = 3 }: { n?: number } = {}): JSX.Element {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-pulse"
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="surface p-5 flex flex-col gap-2">
          <div className="h-2.5 w-24 rounded bg-ink-800/80" />
          <div className="h-7 w-32 rounded bg-ink-800/80 mt-1" />
          <div className="h-2 w-40 rounded bg-ink-800/60 mt-2" />
        </div>
      ))}
    </div>
  );
}

// Vertical list of pulsing rows — icon stub + two text stubs — matched to
// the InsightsSection row layout. Widths alternate so the list doesn't
// look like a repeating pattern.
const LIST_SKELETON_WIDTHS = ['w-3/4', 'w-2/3', 'w-5/6', 'w-1/2', 'w-3/5', 'w-4/5'] as const;

export function ListSkeleton({ rows = 4 }: { rows?: number } = {}): JSX.Element {
  return (
    <div
      className="surface divide-y divide-ink-850 animate-pulse"
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <div className="h-5 w-5 rounded-full bg-ink-800/80 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className={`h-3 rounded bg-ink-800/80 ${LIST_SKELETON_WIDTHS[i % LIST_SKELETON_WIDTHS.length]}`} />
            <div className="h-2.5 w-2/5 rounded bg-ink-800/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
