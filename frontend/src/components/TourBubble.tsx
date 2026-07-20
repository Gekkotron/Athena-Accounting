import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  arrow,
  FloatingArrow,
  useDismiss,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';
import { useTranslation } from 'react-i18next';
import { useTour } from '../contexts/TourContext';
import { TOURS } from '../tips/tours';

const MOBILE_BREAKPOINT = 640;

// The visible popover. Mounted once at the app root inside <TourProvider>.
// Renders null when no tour is running or the current step's anchor is
// unresolved (the TourContext 2s fallback handles the permanent case).
export function TourBubble(): JSX.Element | null {
  const {
    activePageId, stepIdx, getAnchor, anchorVersion,
    nextStep, prevStep, finishTour, skipTour,
  } = useTour();
  const { t } = useTranslation('tips');

  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const arrowRef = useRef<SVGSVGElement | null>(null);
  const anchor = activePageId != null ? getAnchor(TOURS[activePageId][stepIdx]?.anchor) : null;
  const stepDef = activePageId != null ? TOURS[activePageId][stepIdx] : null;
  const desiredPlacement: Placement = (stepDef?.placement ?? 'bottom-start') as Placement;

  const { refs, floatingStyles, context } = useFloating({
    open: activePageId != null && anchor != null && !isMobile,
    placement: desiredPlacement,
    middleware: [offset(10), flip(), shift({ padding: 8 }), arrow({ element: arrowRef })],
    whileElementsMounted: autoUpdate,
  });

  // Keep floating-ui in sync with anchor identity (a re-registration
  // gives us a fresh HTMLElement; refs.setReference must be called with it).
  useLayoutEffect(() => {
    refs.setReference(anchor ?? null);
  }, [anchor, refs, anchorVersion]);

  // Scroll anchor into view on step change (skip the very first step to
  // avoid a page-load jump).
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) { firstRenderRef.current = false; return; }
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const off = rect.top < 0 || rect.bottom > window.innerHeight;
    if (off) anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [stepIdx, anchor]);

  const dismiss = useDismiss(context, { escapeKey: true, outsidePress: false });
  const role = useRole(context, { role: 'dialog' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  // Focus the bubble on step change / open.
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (activePageId != null && bubbleRef.current) bubbleRef.current.focus();
  }, [activePageId, stepIdx]);

  const total = activePageId != null ? TOURS[activePageId].length : 0;
  const isLast = stepIdx >= total - 1;

  const onNextClick = () => {
    if (isLast) finishTour();
    else nextStep();
  };
  const onPrevClick = () => prevStep();

  // useDismiss handles Esc via a document-level listener but only for the
  // OPEN case (i.e. when floating-ui thinks the popover is open). On
  // mobile we short-circuit `open`; wire a local key handler so Esc /
  // arrows work in both layouts.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { skipTour(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { onNextClick(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { onPrevClick(); e.preventDefault(); }
  };

  if (activePageId == null || stepDef == null) return null;

  const titleId = `tour-title-${activePageId}-${stepIdx}`;

  const title = t(`tours.${activePageId}.${stepIdx}.title`);
  const body = t(`tours.${activePageId}.${stepIdx}.body`);
  const counter = t('tour.stepCounter', { step: stepIdx + 1, total });
  const closeAria = t('tour.closeAriaLabel');
  const mobilePointsTo = t('tour.mobilePointsTo');

  const buttonRow = (
    <div className="mt-3 flex items-center justify-between gap-2">
      <div className="text-xs text-ink-500">{counter}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={skipTour}
          className="btn-ghost !min-h-0 !px-2 !py-1 text-xs"
        >
          {t('tour.buttons.skip')}
        </button>
        <button
          type="button"
          onClick={onPrevClick}
          disabled={stepIdx === 0}
          className="btn-ghost !min-h-0 !px-2 !py-1 text-xs disabled:opacity-40"
        >
          {t('tour.buttons.prev')}
        </button>
        <button
          type="button"
          onClick={onNextClick}
          className="btn-primary !min-h-0 !px-3 !py-1 text-xs"
        >
          {isLast ? t('tour.buttons.finish') : t('tour.buttons.next')}
        </button>
      </div>
    </div>
  );

  const content = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 id={titleId} className="text-sm font-medium text-ink-100">{title}</h3>
        <p className="text-sm text-ink-400 mt-1 leading-relaxed">{body}</p>
      </div>
      <button
        type="button"
        aria-label={closeAria}
        onClick={skipTour}
        className="btn-ghost !min-h-0 shrink-0 !px-2 !py-1 text-base leading-none"
      >
        ×
      </button>
    </div>
  );

  // Mobile: dock to bottom, no floating-math, "↑ pointe vers ..." indicator.
  if (isMobile) {
    return createPortal(
      <div
        ref={bubbleRef}
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="surface-soft fixed inset-x-2 bottom-2 z-40 max-w-[calc(100vw-1rem)] rounded-xl border border-ink-800 p-3 shadow-lg outline-none"
      >
        <div className="mb-2 text-xs text-ink-500">{mobilePointsTo}</div>
        {content}
        {buttonRow}
      </div>,
      document.body,
    );
  }

  // Desktop: floating popover positioned by @floating-ui.
  if (!anchor) return null;

  return createPortal(
    <div
      ref={(node) => {
        refs.setFloating(node);
        bubbleRef.current = node as HTMLDivElement | null;
      }}
      style={floatingStyles}
      {...getFloatingProps({
        role: 'dialog',
        'aria-labelledby': titleId,
        tabIndex: -1,
        onKeyDown,
      })}
      className="surface-soft z-40 max-w-[320px] rounded-xl border border-ink-800 p-3 shadow-lg outline-none"
    >
      {content}
      {buttonRow}
      <FloatingArrow ref={arrowRef} context={context} className="fill-ink-900" tipRadius={2} />
    </div>,
    document.body,
  );
}
