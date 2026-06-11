import { useEffect } from 'react';

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** Sim time when issued, for ordering (optional). */
  at?: number;
}

interface ToastsProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

/**
 * Per-kind auto-dismiss. Errors and warnings need more time to read;
 * info/success are fire-and-forget. Tap-to-dismiss always works.
 */
const DISMISS_MS: Record<ToastKind, number> = {
  info: 5000,
  success: 5000,
  warn: 9000,
  error: 12000,
};
/** Maximum toasts rendered on screen at once. Older ones get aggressively
 *  collapsed below so the toast stack never eats the map view on mobile. */
const VISIBLE_LIMIT = 3;

/**
 * Stacked toasts above the bottom scrubber. Each auto-dismisses after
 * a few seconds; user can tap to dismiss earlier.
 *
 * Mobile constraint: the visible toast count is hard-capped so the
 * stack never overflows the gap between the HUD and the scrubber.
 * Anything beyond `VISIBLE_LIMIT` is hidden but kept in state until
 * its auto-dismiss timer fires.
 */
export function Toasts({ toasts, onDismiss }: ToastsProps) {
  useEffect(() => {
    const timers = toasts.map((t) =>
      setTimeout(() => onDismiss(t.id), DISMISS_MS[t.kind] ?? 5000),
    );
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;
  // Newest last in the array → newest at top in the column-reverse stack.
  // Show only the last N most-recent.
  const visible = toasts.slice(-VISIBLE_LIMIT);
  const hidden = toasts.length - visible.length;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {hidden > 0 && (
        <div className="toast-overflow" aria-hidden="true">
          +{hidden} more
        </div>
      )}
      {visible.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast-${t.kind}`}
          onClick={() => onDismiss(t.id)}
          aria-label="dismiss"
        >
          <span className="toast-sym">{symbolFor(t.kind)}</span>
          <span className="toast-text">{t.text}</span>
        </button>
      ))}
    </div>
  );
}

function symbolFor(kind: ToastKind): string {
  switch (kind) {
    case 'success':
      return '✓';
    case 'warn':
      return '⚠';
    case 'error':
      return '!';
    default:
      return '►';
  }
}
