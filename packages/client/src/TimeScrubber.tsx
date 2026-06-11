import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { type World } from '@subterfuge/sim';
import { formatOffset } from './format.js';

interface TimeScrubberProps {
  liveWorld: World;
  /** Offset of the displayed time from live (neg = past, pos = future). */
  scrubOffsetMs: number;
  /** Forward projection horizon (ms). */
  futureRangeMs: number;
  /**
   * Earliest scrubbable sim time (the server's epoch floor). 0 — game
   * start — unless a sim-version promotion raised it; history below
   * this cannot be replayed.
   */
  minTimeMs?: number;
  /** True while the client is fetching a past world from /api/replay. */
  replayLoading?: boolean;
  onScrub: (offsetMs: number) => void;
  onReset: () => void;
}

/** LIVE sits this fraction from the RIGHT of the track; the right
 *  portion is the future window (linear). */
const FUTURE_FRAC = 0.4;
/** Leftmost slice of the track reserved for deep history when the
 *  match has more past than the shared linear rate can cover. */
const FAR_FRAC = 0.15;
/** Movement (px) below which a press counts as a tap, not a drag. */
const TAP_PX = 6;

/**
 * Minimal Time-Machine control: one draggable pill.
 *
 *   idle  →  ◷ live            (drag it sideways to scrub)
 *   past  →  ◷ −1d   (replay)
 *   future → ◷ +2h   (projection, to +4d)
 *
 * Drag left = back in time (server replay, to game start), drag right =
 * forward (deterministic projection). Tap = snap to LIVE. A thin track
 * fades in only while dragging. No markers, no buttons.
 */
export function TimeScrubber({
  liveWorld,
  scrubOffsetMs,
  futureRangeMs,
  minTimeMs = 0,
  replayLoading = false,
  onScrub,
  onReset,
}: TimeScrubberProps) {
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false); // synchronous gate (state lags within an event)
  const downXRef = useRef(0);
  const startFracRef = useRef(0); // axis fraction where the grab began
  const movedRef = useRef(false);

  const isLive = scrubOffsetMs === 0;
  const isFuture = scrubOffsetMs > 0;

  const live = liveWorld.time;
  const future = futureRangeMs;
  // The leftmost reachable moment: game start, or the epoch floor when
  // a sim-version promotion made older history unreplayable.
  const past = Math.max(0, live - minTimeMs);
  // Axis: LIVE at a fixed fraction; both directions move at the SAME
  // sim-ms-per-pixel near live (the future side's linear rate), so a
  // drag feels symmetric — the old sqrt-scaled past had a near-zero
  // slope at live, which made backward scrubbing crawl while forward
  // flew. When history exceeds what the left track can cover at the
  // shared rate, only the leftmost FAR_FRAC compresses (linearly) to
  // keep game start reachable.
  const liveFrac = 1 - FUTURE_FRAC;
  const ratePerFrac = future / FUTURE_FRAC; // sim-ms per unit of track
  const nearFrac = liveFrac - FAR_FRAC;
  // Time the near segment covers at the shared rate. If all history
  // fits inside the full left side at that rate, no tail is needed —
  // the far end of the track simply clamps at the epoch floor.
  const shallow = past <= ratePerFrac * liveFrac;
  const nearSpan = shallow ? past : ratePerFrac * nearFrac;

  const atOfFrac = (frac: number): number => {
    const f = Math.max(0, Math.min(1, frac));
    if (f >= liveFrac) {
      return live + future * ((f - liveFrac) / FUTURE_FRAC);
    }
    const x = liveFrac - f; // 0 at live … liveFrac at the left edge
    if (shallow) return live - Math.min(past, ratePerFrac * x);
    if (x <= nearFrac) return live - ratePerFrac * x;
    const k = Math.min(1, (x - nearFrac) / FAR_FRAC); // 0..1 across the tail
    return live - nearSpan - (past - nearSpan) * k;
  };

  // Axis fraction (0..1) of an absolute sim time — inverse of atOfFrac.
  const fracOf = (at: number): number => {
    if (at >= live) {
      return future <= 0 ? liveFrac : liveFrac + FUTURE_FRAC * ((at - live) / future);
    }
    const dt = live - at;
    if (shallow || dt <= nearSpan) {
      return liveFrac - Math.min(liveFrac, dt / ratePerFrac);
    }
    return liveFrac - nearFrac - ((dt - nearSpan) / (past - nearSpan)) * FAR_FRAC;
  };

  const trackRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    downXRef.current = e.clientX;
    // RELATIVE drag: anchor at the CURRENT time's axis fraction, not the
    // pill's screen position. Dragging right from LIVE therefore always
    // moves into the future (and left into the past), no matter where the
    // pill happens to sit.
    startFracRef.current = fracOf(live + scrubOffsetMs);
    movedRef.current = false;
    draggingRef.current = true;
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!draggingRef.current) return;
    const dx = e.clientX - downXRef.current;
    if (Math.abs(dx) > TAP_PX) movedRef.current = true;
    if (!movedRef.current) return;
    const el = trackRef.current;
    if (!el) return;
    const w = el.getBoundingClientRect().width || 1;
    const frac = Math.max(0, Math.min(1, startFracRef.current + dx / w));
    onScrub(atOfFrac(frac) - live);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!movedRef.current) onReset(); // a tap → live
  };

  const dirClass = isLive ? '' : isFuture ? ' fwd' : ' back';
  const label = isLive
    ? 'live'
    : `${isFuture ? '+' : '−'}${formatOffset(Math.abs(scrubOffsetMs))}`;

  return (
    <>
      <div
        ref={trackRef}
        className={`timepill-track${dragging ? ' dragging' : ''}`}
        style={{ ['--live-pct' as keyof React.CSSProperties]: `${liveFrac * 100}%` }}
        aria-hidden="true"
      />
      <button
        type="button"
        className={`timepill${dirClass}${dragging ? ' dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={isLive ? 'time: live — drag to scrub' : `time ${label} — tap for live`}
      >
        <span className="timepill-glyph">◷</span>
        <span className="timepill-text">{replayLoading ? '⌛' : label}</span>
      </button>
    </>
  );
}

