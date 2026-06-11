import type { DragPreview } from './dragPreview.js';

interface DragPreviewTooltipProps {
  /** Cursor position in CSS pixels (canvas-relative). */
  cursor: { sx: number; sy: number };
  preview: DragPreview;
  /** True when the underlying drag is a what-if (enemy sub source).
   *  Renders a PREVIEW pill above the projection lines and shifts
   *  the border colour to warn-red so the user reads the gesture as
   *  non-committing. */
  previewOnly?: boolean;
}

/**
 * Compact combat-projection tooltip that follows the cursor during a
 * drag-launch / drag-redirect / pirate-retarget gesture. Positions
 * itself to the upper-right of the pointer so the cursor and the
 * drop target remain readable.
 */
export function DragPreviewTooltip({
  cursor,
  preview,
  previewOnly = false,
}: DragPreviewTooltipProps) {
  const outcomeAccent =
    preview.outcome === 'good'
      ? 'var(--phos)'
      : preview.outcome === 'bad'
        ? 'var(--warn)'
        : 'var(--txt-mute)';
  // Preview-only drags get a warn-red border regardless of outcome —
  // the "what if" framing overrides the win/lose colour-coding so the
  // user reads the gesture as planning, not commitment.
  const borderColor = previewOnly ? 'var(--warn)' : outcomeAccent;
  return (
    <div
      className="drag-preview-tooltip"
      style={{
        position: 'absolute',
        left: cursor.sx + 14,
        top: cursor.sy - 12,
        pointerEvents: 'none',
        zIndex: 50,
        padding: '6px 9px',
        background: 'rgba(8, 14, 24, 0.92)',
        border: `1px solid ${borderColor}`,
        fontFamily: 'var(--mono-display)',
        fontSize: 10,
        lineHeight: 1.5,
        letterSpacing: '0.05em',
        color: 'var(--txt)',
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 8px rgba(0,0,0,0.55)',
      }}
    >
      {previewOnly && (
        <div
          style={{
            display: 'inline-block',
            padding: '1px 5px',
            marginBottom: 3,
            fontSize: 9,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--warn)',
            border: '1px solid var(--warn)',
            borderRadius: 2,
          }}
        >
          preview · what if
        </div>
      )}
      {preview.lines.map((line, i) => (
        <div
          key={i}
          style={{
            color: i === preview.lines.length - 1 ? outcomeAccent : 'var(--txt)',
            textTransform: 'uppercase',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
