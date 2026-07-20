import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useTips } from './TipsContext';
import { TOURS, tipIdFor, type AnchorId, type PageId } from '../tips/tours';

interface TourContextValue {
  activePageId: PageId | null;
  stepIdx: number;
  registerAnchor: (id: AnchorId, el: HTMLElement | null) => void;
  getAnchor: (id: AnchorId) => HTMLElement | null;
  anchorVersion: number;
  startTour: (pageId: PageId) => void;
  nextStep: () => void;
  prevStep: () => void;
  finishTour: () => void;
  skipTour: () => void;
  abortTour: () => void;
}

const TourCtx = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourCtx);
  if (!ctx) throw new Error('useTour() must be used inside <TourProvider>');
  return ctx;
}

const MISSING_ANCHOR_TIMEOUT_MS = 2_000;

export function TourProvider({ children }: { children: ReactNode }): JSX.Element {
  const { dismiss } = useTips();
  const location = useLocation();

  const [activePageId, setActivePageId] = useState<PageId | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [anchorVersion, setAnchorVersion] = useState(0);

  // Anchor id → DOM node. Held in a ref (mutations don't need to trigger
  // a render on their own); bumping anchorVersion is what re-renders
  // TourBubble so it can re-resolve.
  const anchorsRef = useRef<Map<AnchorId, HTMLElement>>(new Map());

  const registerAnchor = useCallback((id: AnchorId, el: HTMLElement | null) => {
    if (el == null) anchorsRef.current.delete(id);
    else anchorsRef.current.set(id, el);
    setAnchorVersion((v) => v + 1);
  }, []);

  const getAnchor = useCallback((id: AnchorId) => anchorsRef.current.get(id) ?? null, []);

  const startTour = useCallback((pageId: PageId) => {
    setActivePageId(pageId);
    setStepIdx(0);
  }, []);

  const finishTour = useCallback(() => {
    setActivePageId((current) => {
      if (current) {
        dismiss(tipIdFor(current)).catch(() => {
          // Optimistic update handled by TipsContext; failure is silent.
        });
      }
      return null;
    });
  }, [dismiss]);

  const skipTour = finishTour;

  const abortTour = useCallback(() => {
    setActivePageId(null);
  }, []);

  const nextStep = useCallback(() => {
    if (activePageId == null) return;
    const total = TOURS[activePageId].length;
    if (stepIdx >= total - 1) {
      finishTour();
      return;
    }
    setStepIdx((s) => s + 1);
  }, [activePageId, stepIdx, finishTour]);

  const prevStep = useCallback(() => {
    setStepIdx((s) => Math.max(0, s - 1));
  }, []);

  // Route-change abort. Runs any time `location.pathname` changes and a
  // tour is running. We intentionally do NOT dismiss here.
  const lastPathRef = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== lastPathRef.current) {
      lastPathRef.current = location.pathname;
      setActivePageId((prev) => (prev != null ? null : prev));
    }
  }, [location.pathname]);

  // 2 s missing-anchor auto-skip. Reset on step change, on tour start /
  // stop, and whenever anchorVersion bumps (so a late registration
  // cancels the fallback).
  useEffect(() => {
    if (activePageId == null) return;
    const step = TOURS[activePageId][stepIdx];
    if (step == null) return;
    if (anchorsRef.current.has(step.anchor)) return;
    const t = setTimeout(() => {
      // Re-check inside the timer — the anchor may have registered
      // between the effect scheduling and the timer firing but before
      // the anchorVersion bump could re-run this effect.
      if (anchorsRef.current.has(step.anchor)) return;
      // nextStep semantics inline: if past last, finish; else advance.
      const total = TOURS[activePageId].length;
      if (stepIdx >= total - 1) finishTour();
      else setStepIdx((s) => s + 1);
    }, MISSING_ANCHOR_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [activePageId, stepIdx, anchorVersion, finishTour]);

  const value = useMemo<TourContextValue>(
    () => ({
      activePageId,
      stepIdx,
      registerAnchor,
      getAnchor,
      anchorVersion,
      startTour,
      nextStep,
      prevStep,
      finishTour,
      skipTour,
      abortTour,
    }),
    [
      activePageId, stepIdx, anchorVersion,
      registerAnchor, getAnchor,
      startTour, nextStep, prevStep, finishTour, skipTour, abortTour,
    ],
  );

  return <TourCtx.Provider value={value}>{children}</TourCtx.Provider>;
}
