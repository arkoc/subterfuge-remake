import { memo } from 'react';
import { type Sub, type Outpost } from '@subterfuge/sim';
import { formatEta } from './format.js';

interface SubHoverTooltipProps {
  /** Hover payload from PixiMap (null = not hovering). */
  hover: { subId: number; cursor: { sx: number; sy: number } } | null;
  /** Current visible world (filtered to viewer). Source of sub +
   *  destination outpost lookup. */
  world: { subs: readonly Sub[]; outposts: readonly Outpost[]; time: number } | null;
}

/**
 * Tiny tooltip that follows the cursor when it hovers a sub blip.
 * Shows "→ {destination name} · {eta}" so the player can read a
 * sub's intent without opening its sheet. Pointer-events: none so
 * the cursor still hits the underlying blip / can drag-pan.
 *
 * Driven by PixiMap's `onHoverSub` callback (stage-level hit test
 * against the same SubHit array used for taps — no extra geometry).
 */
function SubHoverTooltipInner({ hover, world }: SubHoverTooltipProps) {
  if (hover === null || world === null) return null;
  const sub = world.subs.find((s) => (s.id as unknown as number) === hover.subId);
  if (sub === undefined) return null;
  const dst = world.outposts.find(
    (o) => (o.id as unknown as number) === (sub.destinationId as unknown as number),
  );
  const dstName = dst?.name ?? '?';
  const etaMs = Math.max(0, sub.arrivalAt - world.time);
  return (
    <div
      className="sub-hover-tooltip"
      style={{
        left: `${hover.cursor.sx + 14}px`,
        top: `${hover.cursor.sy - 14}px`,
      }}
      aria-hidden="true"
    >
      <span className="sub-hover-arrow">→</span>
      <span className="sub-hover-dst">{dstName.toLowerCase()}</span>
      <span className="sub-hover-eta">{formatEta(etaMs)}</span>
    </div>
  );
}

export const SubHoverTooltip = memo(SubHoverTooltipInner);
