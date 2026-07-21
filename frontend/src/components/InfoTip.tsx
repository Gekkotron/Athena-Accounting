// Small info-icon that reveals its `text` on hover via the native title
// tooltip. Zero-dependency, works with keyboard focus, and matches the ink
// palette without needing a floating-ui popper.
export function InfoTip({ text }: { text: string }): JSX.Element {
  return (
    <button
      type="button"
      tabIndex={0}
      title={text}
      aria-label={text}
      className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-ink-600 text-ink-400 text-[9px] font-bold hover:text-ink-100 hover:border-ink-400 transition cursor-help shrink-0"
    >
      ?
    </button>
  );
}
