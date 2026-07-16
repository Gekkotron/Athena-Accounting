export type BatchState =
  | { phase: 'running'; current: number; total: number; currentName: string }
  | {
      phase: 'done';
      imported: number;
      inserted: number;
      skipped: number;
      needsTemplate: string[];
      errors: { file: string; message: string }[];
    };

export function BatchSummaryPanel({
  batch,
  onClose,
}: {
  batch: BatchState;
  onClose: () => void;
}): JSX.Element | null {
  if (batch.phase === 'running') {
    if (batch.total <= 1) return null;
    return (
      <div className="rounded-lg border border-ink-800/60 bg-ink-900/50 px-4 py-3 text-sm text-ink-200">
        Traitement… <span className="font-mono">{batch.current} / {batch.total}</span>{' '}
        <span className="text-ink-500">— {batch.currentName}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-sage-800/40 bg-sage-900/15 px-4 py-3 text-sm text-ink-100 space-y-1">
      <div>
        <span className="font-mono">{batch.imported}</span> fichier{batch.imported > 1 ? 's' : ''} importé{batch.imported > 1 ? 's' : ''} ·{' '}
        <span className="font-mono">{batch.inserted}</span> insérée{batch.inserted > 1 ? 's' : ''} ·{' '}
        <span className="font-mono">{batch.skipped}</span> dédupliquée{batch.skipped > 1 ? 's' : ''}
      </div>
      {batch.needsTemplate.length > 0 && (
        <div className="text-amber-300/90 text-xs">
          {batch.needsTemplate.length} PDF nécessite{batch.needsTemplate.length > 1 ? 'nt' : ''} un template — importez-les individuellement&nbsp;: {batch.needsTemplate.join(', ')}
        </div>
      )}
      {batch.errors.length > 0 && (
        <details className="text-clay-300 text-xs">
          <summary className="cursor-pointer">
            {batch.errors.length} en erreur
          </summary>
          <ul className="mt-1 space-y-0.5 pl-2">
            {batch.errors.map((e) => (
              <li key={e.file} className="font-mono">
                {e.file}: {e.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button
        type="button"
        className="text-[11px] text-ink-500 hover:text-ink-100 transition"
        onClick={onClose}
      >
        Fermer
      </button>
    </div>
  );
}
