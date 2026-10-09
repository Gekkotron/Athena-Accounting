import { LoadingBlock } from '../../components/StateBlocks';

// Four Settings tabs showed the exact same loading block before `useSettings`
// resolved; this centralises the shape (max-w-xl shell + testid for e2e +
// min-h-64 placeholder) so every tab stays visually identical during the
// first paint.
export function SettingsSkeleton(): JSX.Element {
  return (
    <div className="max-w-xl">
      <div data-testid="settings-skeleton">
        <LoadingBlock height="min-h-64" />
      </div>
    </div>
  );
}

// Mutation-failure banner used by every PATCH-driven settings tab. Carries
// role="alert" so screen readers announce the save failure even when nothing
// visibly moves on the page. The copy is caller-provided so the Notifications
// tab (its own i18n key) can route through the same primitive.
export function SaveErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-lg border border-clay-800/60 bg-clay-900/30 px-3 py-2 text-sm text-clay-200"
    >
      {message}
    </div>
  );
}
