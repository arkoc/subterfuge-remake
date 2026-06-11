import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  meta?: string;
  children: ReactNode;
}

/** Swipe-down threshold (px) to commit a sheet dismissal. */
const DISMISS_DRAG_PX = 80;

/**
 * Reusable contextual bottom sheet.
 *
 * - On mobile (<720px): slides up from the bottom, full-width.
 * - On wide screens: docks to the right as a sidebar-like card.
 *
 * The backdrop is shown only on mobile (CSS-controlled). Tap the
 * backdrop or press Escape to close.
 */
// `meta` is still accepted (callers pass a short context line) but no
// longer rendered — sheet headers show the title only.
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  // Live drag offset (px) for the swipe-down gesture. The sheet
  // translates down by this many pixels while the user holds the
  // handle. Released past the threshold → close.
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset drag state when the sheet opens/closes.
  useEffect(() => {
    if (!open) {
      setDragOffset(0);
      dragStartYRef.current = null;
    }
  }, [open]);

  if (!open) return null;

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    dragStartYRef.current = e.clientY;
    // Capture so move/up events keep flowing even if the cursor leaves
    // the handle bar mid-drag.
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const onHandlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragStartYRef.current === null) return;
    const dy = e.clientY - dragStartYRef.current;
    // Only allow downward drag (negative dy is ignored). Apply a
    // small resistance past the dismiss threshold so the sheet
    // doesn't fly off the screen visually before commit.
    setDragOffset(Math.max(0, dy));
  };

  const onHandlePointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragStartYRef.current === null) return;
    const dy = e.clientY - dragStartYRef.current;
    dragStartYRef.current = null;
    try {
      (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (dy > DISMISS_DRAG_PX) {
      onClose();
    } else {
      setDragOffset(0);
    }
  };

  const dragStyle =
    dragOffset > 0
      ? {
          transform: `translateY(${dragOffset}px)`,
          transition: 'none',
        }
      : undefined;

  return (
    <>
      {/* Visual dim only — pointer-events: none on mobile so taps and
          drags on the map below pass through. The user can still close
          the sheet via the handle, the X, or Esc; tapping an outpost
          on the map opens the new sheet directly (the old one is
          replaced, no need to close first). */}
      <div className="sheet-backdrop" role="presentation" />
      <aside className="sheet" aria-modal="false" role="dialog" style={dragStyle}>
        <div
          className="sheet-handle"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onClick={(e) => {
            // A genuine tap (no drag) — close.
            if (Math.abs(dragOffset) < 4) onClose();
            e.stopPropagation();
          }}
          aria-label="close (swipe down or tap)"
        />
        <div className="sheet-header">
          <div className="sheet-header-text">
            {title && <h2>{title}</h2>}
          </div>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label="close panel"
            title="close (Esc)"
          >
            ×
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </aside>
    </>
  );
}
