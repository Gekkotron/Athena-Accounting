import { useEffect, useRef, useState } from 'react';
import type { Transaction } from '../../api/types';

// Keyboard shortcuts for the Transactions list: j/k move a purely visual
// row cursor, e edits the cursor row, d opens its delete confirm, / focuses
// the search input. Inert while the user types in any form control or while
// a modal/dialog is open (`disabled`).
export function useTransactionShortcuts({
  rows,
  disabled,
  onEdit,
  onDelete,
  focusSearch,
}: {
  rows: Transaction[];
  disabled: boolean;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  focusSearch: () => void;
}) {
  const [cursor, setCursor] = useState<number | null>(null);

  // The window listener is bound once; refs keep it reading current values
  // without re-binding on every render.
  const stateRef = useRef({ rows, disabled, onEdit, onDelete, focusSearch, cursor });
  stateRef.current = { rows, disabled, onEdit, onDelete, focusSearch, cursor };

  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el || !el.tagName) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      const s = stateRef.current;
      if (s.disabled) return;

      const clamp = (c: number) => Math.max(0, Math.min(c, s.rows.length - 1));
      const cursorRow = s.cursor != null && s.rows.length > 0 ? s.rows[clamp(s.cursor)] : undefined;

      switch (e.key) {
        case 'j':
          if (s.rows.length === 0) return;
          e.preventDefault();
          setCursor((c) => (c == null ? 0 : clamp(c + 1)));
          break;
        case 'k':
          if (s.rows.length === 0) return;
          e.preventDefault();
          setCursor((c) => (c == null ? 0 : clamp(c - 1)));
          break;
        case 'e':
          if (!cursorRow) return;
          e.preventDefault();
          s.onEdit(cursorRow);
          break;
        case 'd':
          if (!cursorRow) return;
          e.preventDefault();
          s.onDelete(cursorRow);
          break;
        case '/':
          e.preventDefault();
          s.focusSearch();
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cursorId =
    cursor != null && rows.length > 0 ? rows[Math.max(0, Math.min(cursor, rows.length - 1))]!.id : null;

  return { cursorId };
}
