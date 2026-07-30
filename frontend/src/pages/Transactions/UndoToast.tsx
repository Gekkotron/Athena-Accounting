// Bottom-center toast shown while a deletion sits in its undo window.
export function UndoToast({
  label,
  actionLabel,
  onUndo,
}: {
  label: string;
  actionLabel: string;
  onUndo: () => void;
}) {
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 surface flex items-center gap-4 px-4 py-3 shadow-xl"
    >
      <span className="text-sm text-ink-200">{label}</span>
      <button className="btn-secondary text-xs" onClick={onUndo}>
        {actionLabel}
      </button>
    </div>
  );
}
