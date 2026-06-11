import { memo } from 'react';
import { formatOffset } from './format.js';

interface DragScrubTetherProps {
  /** Live cursor position in screen pixels (null when not dragging). */
  cursor: { sx: number; sy: number } | null;
  /** Drag-projected arrival offset from live time in ms (null when not dragging). */
  offsetMs: number | null;
}

/**
 * Visual tether for the drag-to-scrub gesture.
 *
 * Rendered as a fixed overlay on top of the canvas while the user
 * holds a drag from any outpost. It does two jobs:
 *
 *  1. A tooltip near the cursor reading `+8h12m` (the projected
 *     arrival offset). Tells the user what the timeline is doing
 *     without forcing them to look down at the scrubber.
 *  2. A faint vertical dashed line dropping from the cursor toward
 *     the scrubber strip at the bottom. Makes the "drag here ↔
 *     scrubber moves" coupling visible.
 *
 * Both are pointer-events: none so they never intercept the drag.
 *
 * The component is purely visual; the underlying state is driven by
 * PixiMap's onDragScrub callback (extended in this redesign to also
 * pass the cursor position, not just the offset).
 */
function DragScrubTetherInner({ cursor, offsetMs }: DragScrubTetherProps) {
  if (cursor === null || offsetMs === null) return null;
  return (
    <div className="drag-scrub-tether" aria-hidden="true">
      <span
        className="drag-scrub-line"
        style={{
          left: `${cursor.sx}px`,
          top: `${cursor.sy + 18}px`,
        }}
      />
      <span
        className="drag-scrub-tooltip"
        style={{
          left: `${cursor.sx}px`,
          top: `${cursor.sy - 28}px`,
        }}
      >
        +{formatOffset(offsetMs)}
      </span>
    </div>
  );
}

export const DragScrubTether = memo(DragScrubTetherInner);
