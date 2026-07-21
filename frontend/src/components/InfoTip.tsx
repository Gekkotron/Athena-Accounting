import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating, autoUpdate, offset, flip, shift, size,
  useHover, useFocus, useDismiss, useRole, useInteractions,
} from '@floating-ui/react';

// Small info-icon that reveals its `text` in a floating popover on hover or
// keyboard focus. Portaled to document.body so ancestor `overflow-hidden`
// containers (surface cards, table scrollers) never clip the tooltip.
// Zero click behaviour — the button exists only as a hover / focus target.
export function InfoTip({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top',
    middleware: [
      offset(6),
      flip(),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableWidth, elements }) {
          elements.floating.style.maxWidth = `${Math.max(200, Math.min(280, availableWidth))}px`;
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { move: false, delay: { open: 80, close: 60 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={text}
        className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-ink-600 text-ink-400 text-[9px] font-bold hover:text-ink-100 hover:border-ink-400 transition cursor-help shrink-0"
        {...getReferenceProps()}
      >
        ?
      </button>
      {open && createPortal(
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          className="z-50 rounded-md border border-ink-700 bg-ink-800 px-3 py-2 text-xs leading-relaxed text-ink-100 shadow-lg ring-1 ring-ink-950/50 pointer-events-none"
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
