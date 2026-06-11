interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFindQueen: () => void;
  onHelp: () => void;
}

/**
 * Left-side vertical button cluster: zoom in / out / fit / find queen / help.
 * Mobile-friendly 44px touch targets, translucent backdrops.
 */
export function MapControls({
  onZoomIn,
  onZoomOut,
  onFit,
  onFindQueen,
  onHelp,
}: MapControlsProps) {
  return (
    <div className="map-controls" role="toolbar" aria-label="map controls">
      <button type="button" className="map-btn" onClick={onZoomIn} aria-label="zoom in">
        +
      </button>
      <button type="button" className="map-btn" onClick={onZoomOut} aria-label="zoom out">
        −
      </button>
      <button
        type="button"
        className="map-btn"
        onClick={onFit}
        aria-label="fit to map"
        title="fit"
      >
        ⌖
      </button>
      <button
        type="button"
        className="map-btn"
        onClick={onFindQueen}
        aria-label="find your queen"
        title="find queen"
        style={{ color: 'var(--queen-gold)' }}
      >
        ♛
      </button>
      <button
        type="button"
        className="map-btn"
        onClick={onHelp}
        aria-label="help"
        title="help"
      >
        ?
      </button>
    </div>
  );
}
