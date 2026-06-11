import { memo } from 'react';
import type { Outpost, OutpostId } from '@subterfuge/sim';
import { playerColorHex } from './colors.js';

interface ClusterTapPickerProps {
  /** Picker state from PixiMap's onTapCluster (null = no cluster
   *  active). `ids` is sorted by distance to the tap. */
  cluster: { ids: OutpostId[]; cursor: { sx: number; sy: number } } | null;
  /** Current visible world — source of name / owner / kind lookup
   *  for each id in the cluster. */
  world: { outposts: readonly Outpost[] } | null;
  /** Picked an entry → open that outpost's sheet. The App also clears
   *  the picker state. */
  onPick: (id: OutpostId) => void;
  /** "Zoom in instead" — caller fits the cluster within the viewport
   *  so the user can visually disambiguate. The picker dismisses. */
  onZoomToCluster: (ids: OutpostId[]) => void;
  /** Dismissed (tapped outside / Esc / picked) — App clears the
   *  cluster state. */
  onDismiss: () => void;
}

/**
 * Small floating picker for cluster taps. When the user taps a spot
 * on the map where ≥2 outposts overlap (which happens at low zoom or
 * in dense star fields), this lets them pick the one they meant
 * instead of guessing wrong.
 *
 * Anchored near the cursor; rows are name + kind glyph + owner-color
 * swatch so each entry is identifiable at a glance.
 *
 * Closes on outside-tap or Esc (handled by App's keyboard handler);
 * picking a row delegates to the App's normal outpost-tap path.
 */
function ClusterTapPickerInner({
  cluster,
  world,
  onPick,
  onZoomToCluster,
  onDismiss,
}: ClusterTapPickerProps) {
  if (cluster === null || world === null) return null;
  const items = cluster.ids
    .map((id) => world.outposts.find((o) => o.id === id))
    .filter((o): o is Outpost => o !== undefined);
  if (items.length === 0) return null;
  return (
    <>
      {/* Invisible backdrop that catches outside-taps. */}
      <div
        className="cluster-picker-backdrop"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <div
        className="cluster-picker"
        style={{
          left: `${cluster.cursor.sx + 8}px`,
          top: `${cluster.cursor.sy + 8}px`,
        }}
        role="menu"
        aria-label="overlapping outposts"
      >
        <div className="cluster-picker-header">
          {items.length} overlapping · tap to pick
        </div>
        {items.map((o) => (
          <button
            key={o.id}
            type="button"
            className="cluster-picker-row"
            onClick={() => onPick(o.id)}
            role="menuitem"
          >
            <span
              className="cluster-picker-swatch"
              style={{
                background:
                  o.ownerId === null
                    ? 'transparent'
                    : playerColorHex(o.ownerId),
                borderColor:
                  o.ownerId === null
                    ? 'var(--line)'
                    : playerColorHex(o.ownerId),
              }}
              aria-hidden="true"
            />
            <span className="cluster-picker-glyph" aria-hidden="true">
              {kindGlyph(o.kind)}
            </span>
            <span className="cluster-picker-name">{o.name.toLowerCase()}</span>
            <span className="cluster-picker-kind">{o.kind}</span>
          </button>
        ))}
        {/* Secondary affordance — when overlap is dense, zooming in
            is sometimes easier than reading a list of similar names. */}
        <button
          type="button"
          className="cluster-picker-zoom"
          onClick={() => onZoomToCluster(cluster.ids)}
        >
          ⊕ zoom in instead
        </button>
      </div>
    </>
  );
}

function kindGlyph(kind: Outpost['kind']): string {
  switch (kind) {
    case 'factory':
      return '▲';
    case 'generator':
      return '●';
    case 'mine':
      return '◆';
  }
}

export const ClusterTapPicker = memo(ClusterTapPickerInner);
