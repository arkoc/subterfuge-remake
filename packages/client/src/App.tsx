import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type OutpostId,
  type PlayerId,
  type SubId,
  type World,
  DAY_MS,
  electricalOutput,
  HOUR_MS,
  liveNeptuniumThousandths,
  MINUTE_MS,
  NEPTUNIUM_VICTORY_THOUSANDTHS,
  playerById,
  queenOutpostOf,
  SIM_VERSION,
  totalDrillers,
} from '@subterfuge/sim';
import {
  fetchMeta,
  fetchReplayAt,
  openStateStream,
  postPirateTarget,
  postQueuePirateTarget,
  postQueueRedirect,
  postRedirect,
  type StreamStatus,
} from './api.js';
import { PixiMap, type PixiMapHandle, type PulseKind } from './PixiMap.js';
import { DragPreviewTooltip } from './DragPreviewTooltip.js';
import { computeDragPreview, type DragPreview } from './dragPreview.js';
import { TimeScrubber } from './TimeScrubber.js';
import { project } from './projection.js';
import { FABStack } from './FABStack.js';
import { OutpostSheet } from './sheets/OutpostSheet.js';
import { LaunchSheet } from './sheets/LaunchSheet.js';
import { ChatSheet } from './sheets/ChatSheet.js';
import { totalUnread, type ThreadKey } from './chatThreads.js';
import { FleetSheet } from './sheets/FleetSheet.js';
import { QueueSheet } from './sheets/QueueSheet.js';
import { PlayerSwitcherSheet } from './sheets/PlayerSwitcherSheet.js';
import { SubPopoverSheet } from './sheets/SubPopoverSheet.js';
import { HelpSheet } from './sheets/HelpSheet.js';
import { HireSheet } from './sheets/HireSheet.js';
import { EventsSheet } from './sheets/EventsSheet.js';
import { Toasts, type Toast, type ToastKind } from './Toasts.js';
import { useThreats, threatsAsMap } from './useThreats.js';
import { useEventToasts } from './useEventToasts.js';
import { ThreatRibbon } from './ThreatRibbon.js';
import { DragScrubTether } from './DragScrubTether.js';
import { SubHoverTooltip } from './SubHoverTooltip.js';
import { ClusterTapPicker } from './ClusterTapPicker.js';
import { CommandPalette } from './CommandPalette.js';
import { DragHint } from './DragHint.js';
import { playerColorHex, playerLetter } from './colors.js';
import { formatTime } from './format.js';

/** Forward projection horizon for the Time Machine (sim-ms). */
const FUTURE_RANGE_MS = 4 * DAY_MS;

/**
 * Back-scrub snapshot buffer tiers. The server pushes a full filtered
 * world every real tick (500 ms) — at low SIM_SPEED that's tens of
 * thousands of snapshots over a session, and holding (and linearly
 * scanning) them all made past-scrubbing visibly laggy. Keep fine
 * resolution only near live and thin older history; the deep past
 * falls through to /api/replay (5-min grain, cached) anyway.
 */
const HISTORY_FINE_GRAIN_MS = 10_000;
const HISTORY_FINE_WINDOW_MS = 10 * MINUTE_MS;
const HISTORY_COARSE_GRAIN_MS = 5 * MINUTE_MS;
const HISTORY_SPAN_MS = 24 * HOUR_MS;

/** Rightmost snapshot with time <= target, or null. (Binary search —
 *  the buffer is sorted ascending by time.) */
function snapshotAtOrBefore(hist: readonly World[], target: number): World | null {
  let lo = 0;
  let hi = hist.length - 1;
  let found: World | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (hist[mid]!.time <= target) {
      found = hist[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

type LaunchSheetMode = {
  kind: 'launch';
  sourceId: OutpostId;
  destId: OutpostId;
  /** When set, the launch was initiated by dragging a Pirate-carrying
   *  outpost onto an enemy sub. The launch sheet uses this to:
   *    1. pre-check the Pirate at source for boarding
   *    2. display the target sub as the pirate's quarry
   *    3. after `postLaunch`, automatically `postPirateTarget` for the
   *       freshly-launched sub against this targetSubId (skipping the
   *       post-launch map-tap picker entirely). */
  prePiratedTargetSubId?: SubId;
  /** When set, the sheet EDITS this pre-launch sub instead of creating
   *  a new launch — same screen, prefilled, apply/cancel-launch CTAs. */
  editSubId?: SubId;
};

type SheetMode =
  | { kind: 'outpost'; outpostId: OutpostId }
  | LaunchSheetMode
  | { kind: 'sub'; subId: SubId }
  | { kind: 'chat'; thread?: ThreadKey }
  | { kind: 'fleet' }
  | { kind: 'queue' }
  | { kind: 'switcher' }
  | { kind: 'help' }
  | { kind: 'hire' }
  | { kind: 'events' }
  | null;

export function App() {
  const [liveWorld, setLiveWorld] = useState<World | null>(null);
  // WebSocket health. While 'reconnecting' the map keeps rendering the
  // last snapshot (it may be stale) and a banner warns the user.
  const [connStatus, setConnStatus] = useState<StreamStatus>('connected');
  // Earliest sim time the server can replay (epoch baseline). Scrub
  // range and replay fetches clamp to this. Refreshed on reconnect —
  // epoch promotion only happens at server boot, which the WS drop
  // makes visible.
  const [epochFloor, setEpochFloor] = useState(0);
  // Set when the server reports a different sim version than the one
  // this bundle was built with. The Time Machine would silently
  // project wrong futures — surface it instead.
  const [serverSimVersion, setServerSimVersion] = useState<string | null>(null);
  // Bumped by the ChatSheet when a thread's seen-watermark advances —
  // forces the unread badge to recompute from localStorage right away.
  const [chatSeenVersion, setChatSeenVersion] = useState(0);
  useEffect(() => {
    if (connStatus !== 'connected') return;
    let cancelled = false;
    void fetchMeta().then((m) => {
      if (cancelled || m === null) return;
      setEpochFloor(m.epochFloor);
      setServerSimVersion(m.simVersion);
    });
    return () => {
      cancelled = true;
    };
  }, [connStatus]);
  const [activePlayerId, setActivePlayerId] = useState<PlayerId>(0 as PlayerId);
  const [sheet, setSheet] = useState<SheetMode>(null);
  // Picker modes (tap-to-target) were removed in favour of drag-only
  // interactions. The only intent state the UI now tracks is the open
  // sheet (above) and the active drag (PixiMap-internal).
  const [lastSeenEventId, setLastSeenEventId] = useState<number>(-1);
  // Scrubber state. We anchor on an *absolute* sim time rather than
  // an offset-from-live: that keeps the displayed world stable as the
  // live clock advances (without an anchor, "+2h offset" pointed at a
  // shifting target every 500 ms, causing the view to slide forward
  // on every state push and the scrubber thumb to feel jittery).
  // `null` means "follow live".
  const [scrubAnchorAt, setScrubAnchorAt] = useState<number | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    cursor: { sx: number; sy: number };
    preview: DragPreview;
    previewOnly: boolean;
  } | null>(null);
  // Drag-to-scrub overlay state: while the user holds a drag from any
  // outpost, the tether tooltip floats near the cursor showing the
  // projected arrival offset, and a faint vertical dashed line drops
  // toward the scrubber strip. Cleared on drag end.
  const [dragScrub, setDragScrub] = useState<{
    cursor: { sx: number; sy: number };
    offsetMs: number;
  } | null>(null);
  // Snapshot of `scrubAnchorAt` at the moment a drag-scrub gesture
  // started. The drag overwrites the live anchor while in progress
  // (to project the sub's arrival time on the cursor) — when the
  // drag ends WITHOUT a launch, we restore this snapshot instead of
  // snapping back to live, so the user keeps the timeline position
  // they manually set before they grabbed an outpost.
  const preDragScrubAnchorRef = useRef<number | null>(null);
  const dragScrubActiveRef = useRef<boolean>(false);
  // Last drag-preview computation, keyed by gesture + world snapshot.
  // See onDragHover — avoids a structuredClone+tick per pointermove.
  const dragPreviewCacheRef = useRef<{
    key: string;
    preview: DragPreview | null;
  } | null>(null);
  // Pointer-hovered sub for the trail-ETA tooltip. Cleared whenever
  // the pointer leaves a blip or any drag/pan starts.
  const [hoveredSub, setHoveredSub] = useState<{
    subId: number;
    cursor: { sx: number; sy: number };
  } | null>(null);
  // Cluster-tap picker — set when the user taps over a stack of ≥2
  // outposts; cleared when they pick or dismiss.
  const [clusterTap, setClusterTap] = useState<{
    ids: OutpostId[];
    cursor: { sx: number; sy: number };
  } | null>(null);
  // Command palette (Cmd-K) — name-search across outposts.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Cache of past-time worlds fetched from the server's /api/replay
  // endpoint, keyed by sim time. Lets the scrubber pan smoothly over
  // network-fetched history without re-requesting on every change.
  const replayCacheRef = useRef<Map<number, World>>(new Map());
  const [replayLoading, setReplayLoading] = useState<boolean>(false);
  const [fetchedReplay, setFetchedReplay] = useState<World | null>(null);
  // Ring buffer of received liveWorld snapshots, used to scrub
  // **backward** in time. We keep ~24 sim-hours of history; the
  // server snapshots faster than we need, so we deduplicate by
  // world.time as well.
  const historyRef = useRef<World[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const mapRef = useRef<PixiMapHandle | null>(null);

  // Global keyboard shortcuts.
  //   ESC      cancels any picking mode (does not dismiss sheets)
  //   +/=      zoom in
  //   -/_      zoom out
  //   f        fit map
  //   q        find queen
  // Shortcuts are skipped when focus is in an <input>/<textarea> so
  // typing in the chat sheet stays unaffected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Cmd-K / Ctrl-K — open command palette. Handled BEFORE the
      // "any modifier returns" gate so the chord is honoured globally
      // (even when the user is typing in a chat input — they'd expect
      // Cmd-K to escape any text field and open the palette).
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'Escape') {
        // Esc handler — close the topmost dismissible state. Listed
        // in priority order (first match wins). To add a new
        // dismissible state, push another { active, dismiss } entry
        // — no need to thread it through a growing else-if cascade.
        const dismissables: Array<{ active: boolean; dismiss: () => void }> = [
          { active: paletteOpen, dismiss: () => setPaletteOpen(false) },
          { active: clusterTap !== null, dismiss: () => setClusterTap(null) },
          { active: sheet !== null, dismiss: () => setSheet(null) },
        ];
        for (const d of dismissables) {
          if (d.active) {
            d.dismiss();
            e.preventDefault();
            return;
          }
        }
        return;
      }
      const map = mapRef.current;
      if (!map) return;
      if (e.key === '+' || e.key === '=') {
        map.zoomBy(0.5);
        e.preventDefault();
      } else if (e.key === '-' || e.key === '_') {
        map.zoomBy(-0.5);
        e.preventDefault();
      } else if (e.key === 'f' || e.key === 'F') {
        map.fitAll();
        e.preventDefault();
      } else if (e.key === 'q' || e.key === 'Q') {
        const liveWorldNow = liveWorld;
        if (liveWorldNow) {
          const home = queenOutpostOf(liveWorldNow, activePlayerId);
          if (home !== null) {
            map.centerOn(home);
            e.preventDefault();
          }
        }
      } else if (e.key === 'l' || e.key === 'L') {
        // Back to LIVE — clears any scrub anchor (past replay or
        // future projection). Mirrors the on-screen "LIVE" button.
        setScrubAnchorAt(null);
        e.preventDefault();
      } else if (e.key === 'c' || e.key === 'C') {
        setSheet((prev) => (prev?.kind === 'chat' ? null : { kind: 'chat' }));
        e.preventDefault();
      } else if (e.key === 'e' || e.key === 'E') {
        setSheet((prev) => (prev?.kind === 'events' ? null : { kind: 'events' }));
        e.preventDefault();
      } else if (e.key === 'h' || e.key === 'H' || e.key === '?') {
        setSheet((prev) => (prev?.kind === 'help' ? null : { kind: 'help' }));
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    sheet,
    clusterTap,
    paletteOpen,
    liveWorld,
    activePlayerId,
  ]);

  useEffect(() => {
    const close = openStateStream(
      activePlayerId,
      (w) => {
        // Record this snapshot in the back-scrub history. Tiered: fine
        // grain near live, coarse for older entries, hard age-out at
        // the span. Keeps the buffer at a few hundred worlds instead
        // of one per server tick (see HISTORY_* constants).
        const hist = historyRef.current;
        const last = hist[hist.length - 1];
        if (last === undefined || w.time - last.time >= HISTORY_FINE_GRAIN_MS) {
          hist.push(w);
          const cutoff = w.time - HISTORY_SPAN_MS;
          while (hist.length > 0 && hist[0]!.time < cutoff) hist.shift();
          // Thin everything older than the fine window down to the
          // coarse grain. Idempotent (already-thinned entries stay
          // spaced >= the grain), in-place, oldest-first.
          const fineFloor = w.time - HISTORY_FINE_WINDOW_MS;
          let write = 0;
          let lastKeptTime = -Infinity;
          for (let read = 0; read < hist.length; read++) {
            const snap = hist[read]!;
            if (
              snap.time >= fineFloor ||
              snap.time - lastKeptTime >= HISTORY_COARSE_GRAIN_MS
            ) {
              hist[write++] = snap;
              lastKeptTime = snap.time;
            }
          }
          hist.length = write;
        }
        setLiveWorld(w);
      },
      setConnStatus,
    );
    return close;
  }, [activePlayerId]);

  const pushToast = useCallback((kind: ToastKind, text: string): void => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, kind, text }]);
  }, []);

  const dismissToast = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Auto-toast on relevant world events
  useEventToasts({
    liveWorld,
    activePlayerId,
    onToast: pushToast,
  });

  // The world the rest of the UI renders (live / past replay /
  // future projection). Driven by `scrubAnchorAt` — an absolute sim
  // time — so the displayed world stays anchored at the moment the
  // user picked, even as liveWorld advances tick-by-tick.
  const world = useMemo<World | null>(() => {
    if (!liveWorld) return null;
    if (scrubAnchorAt === null) return liveWorld;
    const target = scrubAnchorAt;
    if (target >= liveWorld.time) {
      // Future projection — tick a clone forward from live.
      if (target === liveWorld.time) return liveWorld;
      return project(liveWorld, target);
    }
    // Past — try in-memory snapshot history first.
    const hist = historyRef.current;
    const chosen = snapshotAtOrBefore(hist, target);
    if (chosen !== null) return chosen;
    // Beyond the buffer: use the server-fetched replay if available.
    if (fetchedReplay !== null && Math.abs(fetchedReplay.time - target) <= 60 * 60 * 1000) {
      return fetchedReplay;
    }
    return hist[0] ?? liveWorld;
  }, [liveWorld, scrubAnchorAt, fetchedReplay]);

  // When the scrubber goes back further than the in-memory buffer, kick
  // off a server replay fetch. Deep-past scrubbing can sweep through
  // thousands of distinct anchors, so: (1) SNAP the fetch target to a
  // coarse grain (nearby drag positions share one cached replay) and
  // (2) DEBOUNCE — only fetch once the anchor settles, so dragging
  // doesn't spam /api/replay. The nearest cached/buffered world keeps
  // rendering (with the ⌛ indicator) until the fetch lands.
  useEffect(() => {
    if (!liveWorld || scrubAnchorAt === null) return;
    if (scrubAnchorAt >= liveWorld.time) return;
    const hist = historyRef.current;
    if (hist.some((s) => s.time <= scrubAnchorAt)) return; // in buffer
    const REPLAY_GRAIN_MS = 5 * MINUTE_MS;
    // Clamp to the epoch floor — the server cannot replay below the
    // latest baseline (409) after a sim-version promotion.
    const target = Math.max(
      epochFloor,
      Math.round(scrubAnchorAt / REPLAY_GRAIN_MS) * REPLAY_GRAIN_MS,
    );
    const cached = replayCacheRef.current.get(target);
    if (cached !== undefined) {
      setFetchedReplay(cached);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      setReplayLoading(true);
      void fetchReplayAt(activePlayerId, target).then((w) => {
        if (cancelled) return;
        setReplayLoading(false);
        if (w === null) return;
        const cache = replayCacheRef.current;
        cache.set(target, w);
        // Bound the cache — a deep drag can sweep hundreds of grains.
        // Map iterates in insertion order, so this evicts the oldest.
        while (cache.size > 100) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        setFetchedReplay(w);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [liveWorld, scrubAnchorAt, activePlayerId, epochFloor]);

  // Anchor housekeeping: if the user picked an anchor that has now
  // drifted outside the slider's scrubbable range (live advanced too
  // far past a future anchor, or a past anchor has aged out beyond
  // the 24-hour buffer), snap back to LIVE. Without this the slider
  // thumb would pin at the edge while the world projection silently
  // pointed somewhere else — exactly the slider/state desync the
  // user reported.
  useEffect(() => {
    if (!liveWorld || scrubAnchorAt === null) return;
    // Past is bounded by the epoch floor (game start unless a
    // sim-version promotion raised it); snap to live if the anchor
    // fell below it or drifted past the forward horizon (live
    // advancing past a future anchor).
    if (scrubAnchorAt < epochFloor || scrubAnchorAt > liveWorld.time + FUTURE_RANGE_MS) {
      setScrubAnchorAt(null);
    }
  }, [liveWorld, scrubAnchorAt, epochFloor]);

  const threats = useThreats(world, activePlayerId);

  // Auto-toast / pulse for new sim events. Defined here (above the
  // early return) so its hook position is stable across renders even
  // when the world hasn't loaded yet — React would otherwise complain
  // about a changing hook order.
  //
  // First-load suppression: on a fresh page load `lastSeenEventId`
  // starts at -1 and `world.events` arrives populated with every
  // event in the server's ring buffer (up to ~100). Without this
  // guard, we'd fire a pulse + toast for every old event the user
  // already saw last session. `firstWorldRef` flips after the first
  // world arrives so we silently fast-forward `lastSeenEventId`.
  //
  // Reads `liveWorld`, NOT the projected/scrubbed `world`: a future
  // projection contains *predicted* events with ids past the live
  // watermark — toasting them would announce things that haven't
  // happened, and advancing `lastSeenEventId` past them would swallow
  // the real events when they eventually fire. Scrubbing into the past
  // similarly must not rewind the watermark.
  const firstWorldRef = useRef(true);
  useEffect(() => {
    if (!liveWorld) return;
    if (liveWorld.events.length === 0) return;
    const latestId = liveWorld.events[liveWorld.events.length - 1]!.id;
    if (firstWorldRef.current) {
      firstWorldRef.current = false;
      setLastSeenEventId(latestId);
      return;
    }
    const fresh = liveWorld.events.filter((e) => e.id > lastSeenEventId);
    if (fresh.length === 0) return;
    for (const e of fresh) {
      if (e.pos && mapRef.current) {
        // Map SimEventKind → pulse visual category. Combat-class events
        // (sub-vs-sub, outpost combat) get the orange "engagement"
        // pulse; the martyr blast gets the larger red shockwave to
        // match its destructive scale; everything else is the neutral
        // phosphor ping.
        const pulseKind: PulseKind =
          e.kind === 'martyr_blast'
            ? 'martyr'
            : e.kind === 'combat_outpost' ||
                e.kind === 'combat_sub_vs_sub' ||
                e.kind === 'sentry_shot' ||
                e.kind === 'pirate_intercept'
              ? 'combat'
              : 'info';
        if (e.pos2) {
          mapRef.current.pulseAt(e.pos.x, e.pos.y, e.pos2, pulseKind);
        } else {
          mapRef.current.pulseAt(e.pos.x, e.pos.y, undefined, pulseKind);
        }
      }
    }
    const isEventsOpen = sheet?.kind === 'events';
    if (isEventsOpen) {
      setLastSeenEventId(latestId);
      return;
    }
    for (const e of fresh) {
      // Failed orders (e.g. a pirate-target that couldn't intercept, so
      // the sub just continues to its fallback destination) surface as a
      // prominent error toast — otherwise the failure is invisible and
      // the sub silently "goes to the wrong place".
      pushToast(e.kind === 'order_failed' ? 'error' : 'info', e.summary);
    }
    setLastSeenEventId(latestId);
  }, [liveWorld, lastSeenEventId, sheet, pushToast]);

  // Stable callbacks for the map + rail. All of these are above the
  // early-return so React's hook-order stays consistent between the
  // loading and ready renders.
  const handleDragLaunch = useCallback(
    (sourceId: OutpostId, destId: OutpostId): void => {
      setSheet({ kind: 'launch', sourceId, destId });
    },
    [],
  );
  /** Pirate-launch via drag: source outpost has a Pirate, dropped on
   *  an enemy sub. The launch destination is only a placeholder — the
   *  pirate chase (set right after launch) overrides the path with the
   *  computed intercept. We head toward the target's own destination by
   *  default (same general heading as the target). BUT if the target is
   *  inbound to THIS very outpost, its destination == the source, which
   *  the sim rejects ("source and destination must differ"). In that
   *  case fall back to the target's source outpost (the direction the
   *  enemy is coming from — and where the pirate flies out to meet it). */
  const handleDragLaunchPirate = useCallback(
    (sourceId: OutpostId, targetSubId: SubId): void => {
      const w = liveWorld;
      if (w === null) return;
      const targetSub = w.subs.find((s) => s.id === targetSubId);
      if (targetSub === undefined) return;
      const destId =
        targetSub.destinationId !== sourceId
          ? targetSub.destinationId
          : targetSub.sourceId;
      setSheet({
        kind: 'launch',
        sourceId,
        destId,
        prePiratedTargetSubId: targetSubId,
      });
    },
    [liveWorld],
  );
  /**
   * Effective queue-time for a sub-drag commit (redirect / pirate
   * retarget). Two traps this avoids:
   *
   *  1. STALE ANCHOR: the drag-to-scrub preview moves `scrubAnchorAt`
   *     while the finger is down; on release PixiMap restores it via
   *     setState and then SYNCHRONOUSLY calls the commit callback —
   *     whose closure still sees the drag-preview anchor. Reading the
   *     user's pre-drag anchor from `preDragScrubAnchorRef` (a ref,
   *     immune to render timing) means a live-view redirect commits
   *     IMMEDIATELY instead of queueing itself at the preview time.
   *
   *  2. DOOMED ORDER: a redirect queued at a time ≥ the sub's live
   *     arrival can only fire after the sub has landed — the order is
   *     dead on arrival. Clamp to an immediate redirect and tell the
   *     user.
   */
  const effectiveSubOrderTime = useCallback(
    (subId: SubId, verb: string): number | null => {
      if (liveWorld === null) return null;
      const preAnchor = preDragScrubAnchorRef.current;
      let execAt =
        preAnchor !== null && preAnchor > liveWorld.time ? preAnchor : null;
      const sub = liveWorld.subs.find(
        (s) => (s.id as unknown as number) === (subId as unknown as number),
      );
      if (execAt !== null && sub !== undefined && execAt >= sub.arrivalAt) {
        execAt = null;
        pushToast(
          'info',
          `sub arrives before the scrubbed moment — ${verb} now instead`,
        );
      }
      return execAt;
    },
    [liveWorld, pushToast],
  );
  const handleDragRedirect = useCallback(
    (subId: SubId, destId: OutpostId): void => {
      const body = { ownerId: activePlayerId, subId, newDestinationId: destId };
      const execAt = effectiveSubOrderTime(subId, 'redirecting');
      const req =
        execAt !== null
          ? postQueueRedirect({ ...body, executeAt: execAt })
          : postRedirect(body);
      void req.then((r) => {
        if (!r.ok) pushToast('error', r.error ?? 'redirect failed');
        // No success toast — the Orders sheet IS the confirmation
        // and a queue badge on the QUE FAB lights up immediately.
      });
    },
    [activePlayerId, pushToast, effectiveSubOrderTime],
  );
  const handleDragRetargetPirate = useCallback(
    (subId: SubId, targetSubId: SubId): void => {
      const body = { ownerId: activePlayerId, subId, targetSubId };
      const execAt = effectiveSubOrderTime(subId, 'retargeting');
      const req =
        execAt !== null
          ? postQueuePirateTarget({ ...body, executeAt: execAt })
          : postPirateTarget(body);
      void req.then((r) => {
        if (!r.ok) pushToast('error', r.error ?? 'retarget failed');
      });
    },
    [activePlayerId, pushToast, effectiveSubOrderTime],
  );
  const handleTapEmpty = useCallback((): void => {
    setSheet(null);
  }, []);
  /** Stable identity — this lands in a ChatSheet effect's dependency
   *  array; an inline closure would re-fire it every App render. */
  const handleChatSeen = useCallback((): void => {
    setChatSeenVersion((v) => v + 1);
  }, []);
  const handleOpenSheet = useCallback(
    (s: 'chat' | 'fleet' | 'queue' | 'hire' | 'events' | 'help'): void => {
      // Toggle: tapping the active tab closes its sheet, matching the
      // iOS / Android tab-bar idiom (active tab tap = "back to map").
      setSheet((prev) => (prev?.kind === s ? null : { kind: s }));
    },
    [],
  );
  // handleFit stays — it's the double-tap-to-fit gesture handler. The
  // explicit zoom/fit/queen buttons were removed from the map UI.
  const handleFit = useCallback(() => mapRef.current?.fitAll(), []);

  if (!world || !liveWorld) {
    return (
      <div className="map-host" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="hud">
          <span className="brand">
            <span>subterfuge</span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--txt-mute)',
                letterSpacing: '0.2em',
              }}
            >
              connecting
            </span>
          </span>
        </div>
      </div>
    );
  }

  const me = playerById(world, activePlayerId);
  const liveKg = liveNeptuniumThousandths(world, me, world.time) / 1000;
  // Derive offset from the absolute anchor so consumers can keep
  // their existing "is this scrubbed?" / "where's the slider thumb?"
  // semantics without knowing about the anchor model.
  const scrubOffsetMs =
    scrubAnchorAt === null ? 0 : scrubAnchorAt - liveWorld.time;

  const isScrubbed = scrubOffsetMs > 0;
  const isOffLive = scrubAnchorAt !== null;
  const executeAt = scrubAnchorAt ?? liveWorld.time;
  const npPct = Math.min(100, (liveKg / (NEPTUNIUM_VICTORY_THOUSANDTHS / 1000)) * 100);
  // Economy summary for the HUD pill.
  const stockpile = totalDrillers(world, activePlayerId);
  const cap = electricalOutput(world, activePlayerId);
  const atCap = stockpile >= cap && cap > 0;
  // Single O(N) pass tallies owned/factories/mines instead of three
  // separate .filter walks — runs on every state push.
  let factories = 0;
  let mines = 0;
  let ownedCount = 0;
  for (const o of world.outposts) {
    if (o.ownerId !== activePlayerId) continue;
    ownedCount += 1;
    if (o.kind === 'factory') factories += 1;
    else if (o.kind === 'mine') mines += 1;
  }
  const drillersPerDay = factories * 18; // 6 drillers / 8h × 3 cycles / day
  const kgPerDay = mines * ownedCount;
  const activeSheetKind = sheet?.kind ?? null;
  // Unread badge counts against the LIVE event stream — the projected
  // `world` may contain predicted future events (see the toast effect).
  const unreadEvents = liveWorld.events.filter((e) => e.id > lastSeenEventId).length;

  // Scalar counters for the FABStack — passing the full World would
  // defeat the memo. Two O(N) passes per tick is cheap; the cost
  // would be in re-rendering all rail buttons unnecessarily.
  let myQueued = 0;
  for (const q of world.queuedOrders) if (q.ownerId === activePlayerId) myQueued += 1;
  for (const p of world.pendingCommands) if (p.ownerId === activePlayerId) myQueued += 1;
  // Pre-launch subs count toward the QUE badge too — they're listed
  // in the Orders sheet as cancellable rows like every other order.
  for (const s of world.subs) {
    if (s.ownerId === activePlayerId && s.launchAt > world.time) myQueued += 1;
  }
  // Has the viewer ever issued a launch? Derived from the world —
  // any owned sub (queued, in flight, or already arrived) is proof.
  // Used to graduate the onboarding hint from "drag to launch" →
  // "drag deeper to scrub the timeline".
  let hasLaunched = myQueued > 0;
  if (!hasLaunched) {
    for (const sub of world.subs) {
      if (sub.ownerId === activePlayerId) {
        hasLaunched = true;
        break;
      }
    }
  }
  // Thread-aware unread count (per-thread seen watermarks live in
  // localStorage — see chatThreads.ts). `chatSeenVersion` is bumped by
  // the ChatSheet whenever a watermark advances so the badge clears
  // the instant a thread is read; the count itself is recomputed from
  // the LIVE message stream every render (bounded at 200 messages).
  void chatSeenVersion;
  const unreadMessages = totalUnread(liveWorld, activePlayerId);
  const meForHire = world.players[activePlayerId as unknown as number];
  const hireReady = meForHire !== undefined && world.time >= meForHire.nextHireAt;

  const handleTapOutpost = (id: OutpostId): void => {
    setSheet({ kind: 'outpost', outpostId: id });
    // The sheet docks to the right (desktop) / bottom (mobile); we do
    // NOT move the camera, so the tapped outpost stays exactly where the
    // user clicked it.
  };

  const handleTapSub = (id: SubId): void => {
    // Own pre-launch sub → the unified launch/edit screen (same UI as
    // launching, prefilled). Everything else → the sub popover.
    const sub = liveWorld?.subs.find(
      (x) => (x.id as unknown as number) === (id as unknown as number),
    );
    if (
      sub !== undefined &&
      sub.ownerId === activePlayerId &&
      liveWorld !== null &&
      liveWorld.time < sub.launchAt
    ) {
      setSheet({
        kind: 'launch',
        sourceId: sub.sourceId,
        destId: sub.destinationId,
        editSubId: id,
      });
      return;
    }
    setSheet({ kind: 'sub', subId: id });
  };

  let sheetEl: React.ReactNode = null;
  if (sheet) {
    switch (sheet.kind) {
      case 'outpost': {
        const o = world.outposts.find((x) => x.id === sheet.outpostId);
        if (o) {
          sheetEl = (
            <OutpostSheet
              world={world}
              outpost={o}
              activePlayerId={activePlayerId}
              isScrubbed={isScrubbed}
              executeAt={executeAt}
              onClose={() => setSheet(null)}
              onError={(msg) => msg && pushToast('error', msg)}
              onInfo={(msg) => pushToast('info', msg)}
              onHail={(pid) => setSheet({ kind: 'chat', thread: pid as unknown as number })}
            />
          );
        }
        break;
      }
      case 'launch': {
        const source = world.outposts.find((x) => x.id === sheet.sourceId);
        const dest = world.outposts.find((x) => x.id === sheet.destId);
        // Edit mode: resolve the live pre-launch sub. If it departed or
        // was cancelled while the sheet was open, the world view simply
        // renders no sheet next frame.
        const editSub =
          sheet.editSubId !== undefined
            ? world.subs.find(
                (x) =>
                  (x.id as unknown as number) ===
                    (sheet.editSubId as unknown as number) &&
                  world.time < x.launchAt,
              )
            : undefined;
        if (sheet.editSubId !== undefined && editSub === undefined) break;
        if (source && dest) {
          sheetEl = (
            <LaunchSheet
              world={world}
              source={source}
              destination={dest}
              activePlayerId={activePlayerId}
              isScrubbed={isScrubbed}
              executeAt={executeAt}
              liveTime={liveWorld?.time ?? world.time}
              onClose={() => setSheet(null)}
              onError={(msg) => msg && pushToast('error', msg)}
              onInfo={(msg) => pushToast('info', msg)}
              {...(sheet.prePiratedTargetSubId !== undefined
                ? { prePiratedTargetSubId: sheet.prePiratedTargetSubId }
                : {})}
              {...(editSub !== undefined ? { editSub } : {})}
              onLaunchedWithPirate={(newSubId) => {
                // After launch: if the user pre-targeted (drag-from-
                // pirate-outpost-onto-enemy-sub), auto-wire the chase.
                // Otherwise: nothing — the user can drag the in-flight
                // pirate sub onto an enemy sub when they're ready.
                const preTarget = sheet.kind === 'launch'
                  ? sheet.prePiratedTargetSubId
                  : undefined;
                if (preTarget !== undefined) {
                  void postPirateTarget({
                    ownerId: activePlayerId,
                    subId: newSubId,
                    targetSubId: preTarget,
                  }).then((r) => {
                    if (!r.ok) pushToast('error', r.error ?? 'pirate-target failed');
                  });
                }
              }}
            />
          );
        }
        break;
      }
      case 'sub':
        sheetEl = (
          <SubPopoverSheet
            world={world}
            subId={sheet.subId}
            activePlayerId={activePlayerId}
            onClose={() => setSheet(null)}
          />
        );
        break;
      case 'chat':
        sheetEl = (
          <ChatSheet
            world={world}
            activePlayerId={activePlayerId}
            {...(sheet.thread !== undefined ? { initialThread: sheet.thread } : {})}
            onSeenChange={handleChatSeen}
            onClose={() => setSheet(null)}
            onError={(msg) => msg && pushToast('error', msg)}
            onJumpToOutpost={(id) => {
              setSheet(null);
              mapRef.current?.centerOn(id);
              setSheet({ kind: 'outpost', outpostId: id });
            }}
            onJumpToPlayer={(id) => {
              // DEV-only: switch active POV. Production: no-op until
              // we wire a "view player profile" sheet.
              if (import.meta.env.DEV) setActivePlayerId(id);
            }}
          />
        );
        break;
      case 'fleet':
        sheetEl = (
          <FleetSheet
            world={world}
            activePlayerId={activePlayerId}
            onClose={() => setSheet(null)}
          />
        );
        break;
      case 'queue':
        sheetEl = (
          <QueueSheet
            world={world}
            liveWorld={liveWorld}
            activePlayerId={activePlayerId}
            onClose={() => setSheet(null)}
            onError={(msg) => msg && pushToast('error', msg)}
            onEditSub={(subId) => {
              const sub = liveWorld.subs.find(
                (x) => (x.id as unknown as number) === (subId as unknown as number),
              );
              if (sub !== undefined) {
                setSheet({
                  kind: 'launch',
                  sourceId: sub.sourceId,
                  destId: sub.destinationId,
                  editSubId: subId,
                });
              }
            }}
          />
        );
        break;
      case 'switcher':
        sheetEl = (
          <PlayerSwitcherSheet
            world={world}
            activePlayerId={activePlayerId}
            onSelect={(id) => {
              setActivePlayerId(id);
              setSheet(null);
            }}
            onClose={() => setSheet(null)}
          />
        );
        break;
      case 'help':
        sheetEl = <HelpSheet onClose={() => setSheet(null)} />;
        break;
      case 'hire':
        sheetEl = (
          <HireSheet
            world={world}
            activePlayerId={activePlayerId}
            isScrubbed={isScrubbed}
            executeAt={executeAt}
            onClose={() => setSheet(null)}
            onError={(msg) => msg && pushToast('error', msg)}
            onInfo={(msg) => pushToast('info', msg)}
          />
        );
        break;
      case 'events':
        sheetEl = (
          <EventsSheet
            world={world}
            onClose={() => setSheet(null)}
            onJumpTo={(pos) => mapRef.current?.centerOnPos(pos)}
          />
        );
        break;
    }
  }

  return (
    <>
      <PixiMap
        ref={mapRef}
        world={world}
        activePlayerId={activePlayerId}
        selectedOutpostId={sheet?.kind === 'outpost' ? sheet.outpostId : null}
        threats={threatsAsMap(threats)}
        onTapOutpost={handleTapOutpost}
        onTapSub={handleTapSub}
        onDragLaunch={handleDragLaunch}
        onDragLaunchPirate={handleDragLaunchPirate}
        onDragRedirect={handleDragRedirect}
        onDragRetargetPirate={handleDragRetargetPirate}
        onDragHover={(info) => {
          if (info === null) {
            setDragPreview(null);
            dragPreviewCacheRef.current = null;
            return;
          }
          // The preview result depends only on the gesture identity and
          // the world snapshot — NOT the cursor (that just positions the
          // tooltip). Pointermove fires at display rate; recomputing per
          // move structuredClones + ticks the world each time. Cache by
          // key so only target/world changes pay the sim cost.
          const key = `${info.drag}|${info.sourceId}|${info.target?.kind ?? '-'}:${info.target?.id ?? -1}|${liveWorld.time}|${activePlayerId}`;
          const cached = dragPreviewCacheRef.current;
          const preview =
            cached !== null && cached.key === key
              ? cached.preview
              : computeDragPreview(liveWorld, activePlayerId, info);
          dragPreviewCacheRef.current = { key, preview };
          setDragPreview(
            preview === null
              ? null
              : { cursor: info.cursor, preview, previewOnly: info.previewOnly },
          );
        }}
        onTapEmpty={handleTapEmpty}
        onDoubleTap={handleFit}
        onDragChange={(active) => {
          // When a drag starts, close any open sheet (esp. the
          // outpost sheet) so the user's drag isn't fighting a
          // bottom-sheet overlay for focus. The drag rubber-band
          // and scrubber tether should own the screen during the
          // gesture.
          if (active) setSheet(null);
          if (!active) setDragPreview(null);
        }}
        onDragScrub={(offsetMs, cursor) => {
          if (offsetMs === null) {
            // Drag ended without a launch. Restore the timeline to
            // whatever the user had manually set BEFORE they grabbed
            // an outpost — snapping back to live here would discard
            // their scrubbed position, which is the bug the user hit
            // when scrubbing forward then dragging to queue.
            if (dragScrubActiveRef.current) {
              setScrubAnchorAt(preDragScrubAnchorRef.current);
              dragScrubActiveRef.current = false;
            }
            setDragScrub(null);
            return;
          }
          // First emit of a fresh drag — capture the pre-drag anchor
          // so we can restore it on drag-end. Subsequent emits in the
          // same drag should NOT update the snapshot.
          if (!dragScrubActiveRef.current) {
            preDragScrubAnchorRef.current = scrubAnchorAt;
            dragScrubActiveRef.current = true;
          }
          // Project the arrival time relative to the user's pre-drag
          // anchor (or live if there was none). The drag's `offsetMs`
          // is pure travel time; the absolute arrival is anchor + travel.
          const base = preDragScrubAnchorRef.current ?? liveWorld.time;
          setScrubAnchorAt(base + offsetMs);
          setDragScrub(
            cursor === null || cursor === undefined ? null : { cursor, offsetMs },
          );
        }}
        onHoverSub={(payload) => {
          setHoveredSub(
            payload === null
              ? null
              : {
                  subId: payload.subId as unknown as number,
                  cursor: payload.cursor,
                },
          );
        }}
        onTapCluster={(ids, cursor) => setClusterTap({ ids, cursor })}
      />

      {/* Map controls (queen, fit, zoom, help) live in the floating
          .map-tools cluster at the top-right; primary nav (msg, flt,
          que, hir, log) lives in the bottom .tabbar. Both are rendered
          by the FABStack component below. */}

      {/* Time-travel frame tint — the whole viewport shifts colour the
          moment the displayed world is not LIVE: violet wash + drifting
          scanlines for the replayed past, cyan for the projected future.
          Pure CSS, pointer-events:none, sits between map and HUD. */}
      {isOffLive && (
        <div
          className={`timetint ${scrubOffsetMs > 0 ? 'fwd' : 'back'}`}
          aria-hidden="true"
        />
      )}

      <div className="hud">
        {/* Time stat — clickable only when scrubbed (tap = back to LIVE).
            When live it stays a non-interactive span so the cursor
            doesn't suggest action. */}
        {isOffLive ? (
          <button
            type="button"
            className={`stat hud-link scrubbed ${scrubOffsetMs > 0 ? 'scrub-fwd' : 'scrub-back'}`}
            title={
              scrubOffsetMs > 0
                ? 'projected future — tap to snap back to live'
                : 'replaying past — tap to snap back to live'
            }
            onClick={() => setScrubAnchorAt(null)}
          >
            <span className="glyph" aria-hidden="true">{'⏱︎'}</span>
            <span className="value">{formatTime(world.time)}</span>
          </button>
        ) : (
          <span className="stat" title="sim time elapsed">
            <span className="glyph" aria-hidden="true">{'⏱︎'}</span>
            <span className="value">{formatTime(world.time)}</span>
          </span>
        )}

        <span className="sep" aria-hidden="true" />

        {/* Drillers / electrical cap — tap opens the fleet sheet to
            show per-outpost breakdown. */}
        <button
          type="button"
          className={`stat hud-link ${atCap ? 'warn' : ''}`}
          title={
            atCap
              ? 'at electrical cap — factories paused. tap to open fleet'
              : `drillers / electrical cap · +${drillersPerDay}/day from ${factories} factories · tap for fleet`
          }
          onClick={() =>
            setSheet((prev) => (prev?.kind === 'fleet' ? null : { kind: 'fleet' }))
          }
        >
          <span className="glyph" aria-hidden="true">{'⚡︎'}</span>
          <span className="value">
            {stockpile}
            {/* The cap divisor stays visible — "153" alone says nothing
                about how close to cap you are. The per-day rate lives in
                the fleet sheet; the HUD stays a clean glance. */}
            <span className="sub keep-mobile">/{cap}</span>
          </span>
          {atCap && <span className="sub">capped</span>}
        </button>

        <span className="sep" aria-hidden="true" />

        {/* Neptunium — tap opens fleet (showing mine progress alongside
            other outposts). No dedicated "production" sheet exists yet. */}
        <button
          type="button"
          className="stat hud-link"
          title={`neptunium · victory at ${NEPTUNIUM_VICTORY_THOUSANDTHS / 1000} kg${kgPerDay ? ` · +${kgPerDay} kg/day` : ''} · tap for fleet`}
          onClick={() =>
            setSheet((prev) => (prev?.kind === 'fleet' ? null : { kind: 'fleet' }))
          }
        >
          <span className="glyph" aria-hidden="true">◇</span>
          <span className="value">
            {liveKg.toFixed(1)}
            <span className="sub">kg</span>
          </span>
          <span className="victory-bar" aria-hidden="true">
            <span style={{ width: `${npPct}%` }} />
            {/* Rival ticks — the Neptunium RACE at a glance: one tick
                per living opponent at their live progress toward the
                200 kg line. The race is deliberately public (docs/07). */}
            {world.players
              .filter((p) => p.id !== activePlayerId && !p.eliminated)
              .map((p) => {
                const pct = Math.min(
                  100,
                  (liveNeptuniumThousandths(world, p, world.time) /
                    NEPTUNIUM_VICTORY_THOUSANDTHS) *
                    100,
                );
                if (pct <= 0.5) return null;
                return (
                  <i
                    key={p.id as unknown as number}
                    className="rival"
                    style={{
                      left: `${pct}%`,
                      background: playerColorHex(p.id),
                    }}
                  />
                );
              })}
          </span>
        </button>

        <span className="grow" aria-hidden="true" />

        {world.winnerId !== null && (
          <span className="winner">
            winner · {playerLetter(world.winnerId)}
          </span>
        )}

        <button
          type="button"
          className="player-chip"
          onClick={() => {
            // Player switching is a dev-only convenience for testing
            // multiple perspectives on the same world. In a production
            // build the chip is read-only "this is you". Hooked off
            // Vite's import.meta.env.DEV so the gate is statically
            // dead-code-eliminated in production.
            if (import.meta.env.DEV) setSheet({ kind: 'switcher' });
          }}
          aria-label={import.meta.env.DEV ? 'switch player' : 'active player'}
        >
          <span
            className="value"
            style={{ color: playerColorHex(activePlayerId) }}
          >
            {playerLetter(activePlayerId)}
          </span>
          <span
            className="swatch"
            style={{
              background: playerColorHex(activePlayerId),
              color: playerColorHex(activePlayerId),
            }}
          />
        </button>
      </div>

      <ThreatRibbon
        threats={threats}
        onOpenOutpost={(id) => {
          mapRef.current?.centerOn(id);
          setSheet({ kind: 'outpost', outpostId: id });
        }}
        onOpenEvents={() => setSheet({ kind: 'events' })}
      />
      <DragScrubTether
        cursor={dragScrub?.cursor ?? null}
        offsetMs={dragScrub?.offsetMs ?? null}
      />
      {/* Hide the hover tooltip during an active drag — the drag overlay
          + scrub tether already own the screen and a stale tooltip would
          fight for attention. */}
      <SubHoverTooltip
        hover={dragScrub === null ? hoveredSub : null}
        world={world}
      />
      <DragHint hasLaunched={hasLaunched} />
      <ClusterTapPicker
        cluster={clusterTap}
        world={world}
        onPick={(id) => {
          setClusterTap(null);
          handleTapOutpost(id);
        }}
        onZoomToCluster={(ids) => {
          setClusterTap(null);
          mapRef.current?.fitOutposts(ids);
        }}
        onDismiss={() => setClusterTap(null)}
      />
      <CommandPalette
        open={paletteOpen}
        world={world}
        onPick={(id) => {
          setPaletteOpen(false);
          mapRef.current?.centerOn(id);
          setSheet({ kind: 'outpost', outpostId: id });
        }}
        onClose={() => setPaletteOpen(false)}
      />

      {dragPreview !== null && (
        <DragPreviewTooltip
          cursor={dragPreview.cursor}
          preview={dragPreview.preview}
          previewOnly={dragPreview.previewOnly}
        />
      )}

      <FABStack
        myQueued={myQueued}
        unread={unreadMessages}
        hireReady={hireReady}
        activeSheet={activeSheetKind}
        unreadEvents={unreadEvents}
        onOpen={handleOpenSheet}
      />

      <TimeScrubber
        liveWorld={liveWorld}
        scrubOffsetMs={scrubOffsetMs}
        futureRangeMs={FUTURE_RANGE_MS}
        minTimeMs={epochFloor}
        replayLoading={replayLoading}
        onScrub={(offset) => {
          // Snap small offsets (≈ noise around the live point) to true
          // live so a near-centre release clicks into LIVE.
          if (Math.abs(offset) <= 30 * 1000) {
            setScrubAnchorAt(null);
          } else {
            setScrubAnchorAt(liveWorld.time + offset);
          }
        }}
        onReset={() => setScrubAnchorAt(null)}
      />

      {sheetEl}

      {connStatus === 'reconnecting' && (
        <div role="status" className="conn-banner">
          connection lost — reconnecting… view may be stale
        </div>
      )}
      {serverSimVersion !== null && serverSimVersion !== SIM_VERSION && (
        <div role="alert" className="conn-banner">
          sim version mismatch — server {serverSimVersion}, client {SIM_VERSION}.
          reload the page.
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

