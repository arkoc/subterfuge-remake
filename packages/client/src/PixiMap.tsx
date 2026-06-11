import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  forwardRef,
  type MutableRefObject,
} from 'react';
import {
  Application,
  Container,
  type FederatedPointerEvent,
  Graphics,
  Rectangle,
  RenderTexture,
  Text,
  type TextStyleOptions,
  TilingSprite,
} from 'pixi.js';
import {
  MAP_SIZE,
  type Coord,
  type Outpost,
  type OutpostId,
  type PlayerId,
  type Sub,
  type SubId,
  type World,
  currentShieldCharge,
  dist,
  electricalOutput,
  hasQueenAt,
  LAUNCH_DELAY_MS,
  maxShieldCharge,
  queenOutpostOf,
  MINUTE_MS,
  mirrorEncounterTime,
  previewSpeed,
  simulateMultipleSubArrivals,
  sonarRange,
  subPosition,
  subStatus,
  torusDelta,
  totalDrillers,
  travelTimeMs,
  virtualDestination,
  HOUR_MS,
} from '@subterfuge/sim';
import { playerColor } from './colors.js';
import { SPECIALISTS } from './specialistInfo.js';
import { formatEta } from './format.js';

// ============================================================================
// PixiMap
// ----------------------------------------------------------------------------
// Design constraints:
//   • Full-screen — the map fills the entire viewport; HUD/scrubber/FABs
//     simply overlay on top.
//   • Stable scene graph — one OutpostNode / SubNode per entity, reused
//     across world updates. World ticks only push graphical diffs into
//     existing nodes; no per-tick removeChildren / new Text() churn.
//   • Manual render — pixi's auto-ticker is stopped; we render only when
//     state changes. Idle tab cost approaches zero.
//   • Simple camera — screen = world * zoom + pan. Wheel zooms around
//     the cursor; buttons around screen center.
// ============================================================================

// ---------- Camera bounds ----------

// MIN_ZOOM is intentionally lower than "one tile fills the viewport" so the
// player can zoom out far enough to see the world repeating across tile
// boundaries — that's what gives the map its "no corners / infinite" feel.
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 0.6;
const DEFAULT_ZOOM = 0.12;

// Hard ceiling on how many tile copies of the world we'll draw in a single
// frame. With ~40 outposts per tile and a few graphics each, this still
// leaves comfortable headroom even on weaker devices. If the user zooms
// out beyond this they just see the canonical 5×5 neighbourhood.
const MAX_TILES = 64;

// Minimum interval between will-lose preview re-computations. The preview
// is allowed to lag by up to this window — for shield-recharge time
// scales, a 1.5 s delay is invisible.
const WILL_LOSE_REFRESH_MS = 1500;
// Sim-time window over which an inbound sub is "close enough to
// project". Subs arriving further in the future don't drive
// immediate player decisions; deferring their projection keeps the
// per-refresh clone work bounded as games grow large.
const WILL_LOSE_HORIZON_MS = 12 * HOUR_MS;

// ---------- Interaction thresholds (screen px²) ----------

// Slop tuned for touch — a finger tap commonly drifts 8-12 px between
// pointerdown and pointerup. Tight slop was rejecting tap intents as
// "moved too much" and ignoring them.
const TAP_SLOP_PX2 = 196; // 14 px
const PAN_SLOP_PX2 = 36; // 6 px

// ---------- Outpost geometry (constant screen px) ----------

const OUTPOST_R = 12;
const OUTPOST_HIT_R = OUTPOST_R + 24;

// ---------- Zoom-driven LOD thresholds ----------
// On a fit-to-map view the camera zoom sits around 0.07; at "find queen"
// it's around DEFAULT_ZOOM (0.12). The NAME_VISIBLE_ZOOM threshold
// suppresses the name labels at low zoom so a fit-to-map view doesn't
// turn into a wall of text.
//
// Driller counts, on the other hand, are critical situational
// awareness on mobile — the player should always see "who has how
// many" without having to pinch-zoom. So we always render the number;
// the name label is the only LOD-gated piece.
const NAME_VISIBLE_ZOOM = 0.09;
const DRILLERS_VISIBLE_ZOOM = 0;

// ---------- Palette ----------

const PHOS = 0x7af0c8;
const WARN = 0xff5470;
const SHIELD_STROKE = 0x6f9ad6;
const THREAT_RED = 0xff5470;
const TEXT_BRIGHT = 0xd8e6f2;
const TEXT_DIM = 0x8aa0bd;
const TEXT_MUTE = 0x5a708f;
const SELECT_WHITE = 0xffffff;
const BG_DEEP = 0x050e1f;

const NAME_STYLE: TextStyleOptions = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 9,
  fill: TEXT_DIM,
  letterSpacing: 1.5,
};
const DRILLERS_STYLE: TextStyleOptions = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 14,
  fontWeight: '700',
  fill: TEXT_BRIGHT,
  letterSpacing: 0.5,
  stroke: { color: BG_DEEP, width: 2 },
};
/** Numeric shield indicator on owned outposts (e.g. `12/20`). Sits
 *  opposite the drillers count so the two labels don't collide. */
const SHIELD_STYLE: TextStyleOptions = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 9,
  fill: SHIELD_STROKE,
  letterSpacing: 0.3,
};
const SUB_LABEL_STYLE: TextStyleOptions = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 13,
  fontWeight: '700',
  fill: TEXT_BRIGHT,
  letterSpacing: 0.4,
  stroke: { color: BG_DEEP, width: 3 },
};
// Specialist chip text — single bracket-row format. Multiple
// specialists at the same entity render as `[♛,◉,⚓]` (one bracket,
// commas between glyphs), NOT `[♛] [◉] [⚓]` (separate brackets).
// The single-bracket form is more compact at every count and
// matches a terminal/log aesthetic the rest of the chrome leans on.
// A thin dark stroke keeps the text readable against bright map
// backgrounds without needing a separate BG rectangle.
const SPECS_STYLE: TextStyleOptions = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 15,
  fontWeight: '700',
  fill: 0xffffff,
  letterSpacing: 0.5,
  stroke: { color: BG_DEEP, width: 3 },
};
const SPECS_SUB_STYLE: TextStyleOptions = {
  fontFamily: 'IBM Plex Mono, monospace',
  fontSize: 12,
  fontWeight: '700',
  fill: 0xffffff,
  letterSpacing: 0.3,
  stroke: { color: BG_DEEP, width: 2 },
};

/** Shared "no specialists" sentinel — saves an allocation per call
 *  to OutpostNode.update / SubNode.update on quiet entities. */
const EMPTY_SPECS: readonly string[] = Object.freeze([]);

// ============================================================================
// Bathymetric chart layer
// ----------------------------------------------------------------------------
// The signature backdrop: faint depth-contour isolines across the whole
// ocean, like a naval survey chart. Drawn ONCE into a RenderTexture at
// startup and tiled by a single TilingSprite quad, so the per-frame cost
// is setting four scalar fields — the cheap-idle property is untouched.
//
// The depth field is a sum of integer-frequency cosine harmonics, which
// makes it exactly periodic on the torus: the tile seams are invisible
// and the TilingSprite wrap mirrors the map's own wrap. Purely
// decorative, so the seed is a fixed constant (the world seed is
// redacted client-side anyway).

const BATHY_TEX = 1024;

/** Deterministic tiny PRNG (mulberry32) for the harmonic table. */
function bathyRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the tiling bathymetry sprite. Marching-squares isolines over a
 * torus-periodic harmonic field; "index" contours (every third level)
 * render in phosphor, the rest in a desaturated chart blue.
 */
function buildBathymetry(app: Application): TilingSprite {
  const rng = bathyRng(0x5eabed);
  // Harmonic table: low integer frequencies → broad basins and ridges.
  const H = 10;
  const kx: number[] = [];
  const ky: number[] = [];
  const ph: number[] = [];
  const amp: number[] = [];
  for (let i = 0; i < H; i++) {
    const fx = Math.floor(rng() * 4) - 2 + (rng() < 0.5 ? -1 : 1); // -3..3, never 0-heavy
    const fy = Math.floor(rng() * 4) - 2 + (rng() < 0.5 ? -1 : 1);
    kx.push(fx === 0 ? 1 : fx);
    ky.push(fy === 0 ? 1 : fy);
    ph.push(rng() * Math.PI * 2);
    amp.push(0.4 + rng() * 0.6);
  }
  const field = (u: number, v: number): number => {
    let s = 0;
    let norm = 0;
    for (let i = 0; i < H; i++) {
      s += amp[i]! * Math.cos(2 * Math.PI * (kx[i]! * u + ky[i]! * v) + ph[i]!);
      norm += amp[i]!;
    }
    return s / norm; // ≈ [-1, 1]
  };

  // Sample once into a grid, then march each iso level.
  const G = 144;
  const samples = new Float64Array((G + 1) * (G + 1));
  for (let j = 0; j <= G; j++) {
    for (let i = 0; i <= G; i++) {
      samples[j * (G + 1) + i] = field(i / G, j / G);
    }
  }
  const cell = BATHY_TEX / G;
  const g = new Graphics();
  const levels = [-0.5, -0.34, -0.18, -0.02, 0.14, 0.3, 0.46, 0.62];
  for (let li = 0; li < levels.length; li++) {
    const iso = levels[li]!;
    const isIndex = li % 3 === 0;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const tl = samples[j * (G + 1) + i]! - iso;
        const tr = samples[j * (G + 1) + i + 1]! - iso;
        const br = samples[(j + 1) * (G + 1) + i + 1]! - iso;
        const bl = samples[(j + 1) * (G + 1) + i]! - iso;
        const idx =
          (tl > 0 ? 8 : 0) | (tr > 0 ? 4 : 0) | (br > 0 ? 2 : 0) | (bl > 0 ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const x0 = i * cell;
        const y0 = j * cell;
        // Edge interpolators (t of the zero crossing along each edge).
        const top = { x: x0 + cell * (tl / (tl - tr)), y: y0 };
        const right = { x: x0 + cell, y: y0 + cell * (tr / (tr - br)) };
        const bottom = { x: x0 + cell * (bl / (bl - br)), y: y0 + cell };
        const left = { x: x0, y: y0 + cell * (tl / (tl - bl)) };
        const seg = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        };
        // Standard marching-squares cases (ambiguous saddles split arbitrarily —
        // fine for decorative hairlines).
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(top, left); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(top, left); break;
          case 10: seg(top, right); seg(left, bottom); break;
        }
      }
    }
    g.stroke(
      isIndex
        ? { width: 1.1, color: PHOS, alpha: 0.085 }
        : { width: 0.8, color: 0x3e6a9a, alpha: 0.16 },
    );
  }

  const tex = RenderTexture.create({
    width: BATHY_TEX,
    height: BATHY_TEX,
    antialias: true,
  });
  app.renderer.render({ container: g, target: tex });
  // Destroy AFTER the renderer's first real frame: tearing the source
  // Graphics down synchronously after a render-to-texture leaves the
  // batcher's cached context data dangling — null deref inside
  // GraphicsContextSystem on the first stage render.
  setTimeout(() => g.destroy(), 2000);
  const sprite = new TilingSprite({ texture: tex, width: 1, height: 1 });
  return sprite;
}

/**
 * One specialist row — a single Text whose content is the full
 * comma-joined glyph list wrapped in literal square brackets, e.g.
 * `[♛,◉,⚓]`. Reused per-frame by `layoutChipRow`; the rendering
 * code never destroys + recreates these (Pixi v8 Text-texture pool
 * hates rapid teardown — see the rendering comments throughout).
 *
 * Single-bracket format chosen over per-glyph pills for compactness
 * and to match the terminal-log aesthetic of the chrome. A thin
 * stroke + drop-shadow on the text style provides readable contrast
 * against the map without needing a separate BG rectangle.
 */
interface ChipItem {
  text: Text;
}

/**
 * Render the glyph row as a single bracketed comma-joined Text into
 * `container`. The pool holds at most one item (allocated lazily on
 * first call). Owner colour is applied via `tint`. Caller positions
 * `container`; this function just sets the Text content + tint and
 * centres the Text on the container origin.
 */
/** Max glyphs per bracketed row before wrapping to the next line. */
const CHIP_ROW_MAX = 4;
/** Vertical spacing between wrapped chip rows (in screen px). Slightly
 *  taller than text height so adjacent rows don't visually touch. */
const CHIP_ROW_HEIGHT = 16;

/** Compose one row's text inside a SHARED bracket pair that spans
 *  every row in a wrapped chip. So 6 glyphs split into 2 rows render
 *  as `[a,b,c,d,` (top) + `e,f]` (bottom) — one logical bracket pair,
 *  not duplicated per row. */
function chipRowText(
  glyphs: readonly string[],
  rowIdx: number,
  totalRows: number,
): string {
  const inner = glyphs.join(',');
  if (totalRows === 1) return `[${inner}]`;
  if (rowIdx === 0) return `[${inner},`;
  if (rowIdx === totalRows - 1) return `${inner}]`;
  return `${inner},`;
}

function layoutChipRow(
  container: Container,
  pool: ChipItem[],
  glyphs: readonly string[],
  ownerColor: number,
  textStyle: TextStyleOptions,
  _spacing: { gap: number },
): void {
  // Split into rows of at most CHIP_ROW_MAX glyphs. Each row is its
  // own Text inside the same container, stacked vertically with the
  // last row sitting at y=0 (the container's anchor) so the visual
  // grows UPWARD — important for the row above an outpost where we
  // want the bottom of the chip to stay clear of the outpost body.
  const rows: string[][] = [];
  for (let i = 0; i < glyphs.length; i += CHIP_ROW_MAX) {
    rows.push(glyphs.slice(i, i + CHIP_ROW_MAX));
  }
  // Grow pool to row count.
  while (pool.length < rows.length) {
    const text = new Text({ text: '', style: textStyle });
    text.anchor.set(0.5, 0.5);
    pool.push({ text });
    container.addChild(text);
  }
  // Hide unused pool entries.
  for (let i = rows.length; i < pool.length; i++) {
    pool[i]!.text.visible = false;
  }
  for (let i = 0; i < rows.length; i++) {
    const item = pool[i]!;
    const txt = chipRowText(rows[i]!, i, rows.length);
    if (item.text.text !== txt) item.text.text = txt;
    item.text.tint = ownerColor;
    item.text.visible = true;
    // Stack so the LAST row is at y=0; earlier rows go upward
    // (negative y). This keeps the row growing away from the outpost
    // body regardless of how many wraps happen.
    item.text.position.set(0, -(rows.length - 1 - i) * CHIP_ROW_HEIGHT);
  }
}

/**
 * Render captive chips — each ORIGINAL OWNER is one logical chip
 * tinted in that player's colour and occupying its own row (or rows
 * if it wraps past CHIP_ROW_MAX). Owner groups stack vertically; the
 * container origin sits at the TOP row's baseline, growing DOWNWARD
 * away from the outpost body above.
 *
 * Wrapping uses a single bracket pair per owner that spans every
 * wrapped row — so 6 captives from player B render as
 * `[♛,◉,⚓,$,` (top) + `†,◊]` (bottom), NOT `[♛,◉,⚓,$]` + `[†,◊]`.
 */
function layoutCaptiveRow(
  container: Container,
  pool: ChipItem[],
  groups: ReadonlyArray<{ ownerId: number; glyphs: string[] }>,
  textStyle: TextStyleOptions,
): void {
  // For each owner-group, split into rows (CHIP_ROW_MAX max per row)
  // and emit one Text per row, sharing the same tint and using
  // `chipRowText` so the bracket pair is shared across rows.
  type Subline = { tint: number; text: string };
  const sublines: Subline[] = [];
  for (const g of groups) {
    const tint = playerColor(g.ownerId as unknown as PlayerId);
    const rows: string[][] = [];
    for (let i = 0; i < g.glyphs.length; i += CHIP_ROW_MAX) {
      rows.push(g.glyphs.slice(i, i + CHIP_ROW_MAX));
    }
    for (let r = 0; r < rows.length; r++) {
      sublines.push({ tint, text: chipRowText(rows[r]!, r, rows.length) });
    }
  }
  // Grow pool, hide extras.
  while (pool.length < sublines.length) {
    const t = new Text({ text: '', style: textStyle });
    t.anchor.set(0.5, 0.5);
    pool.push({ text: t });
    container.addChild(t);
  }
  for (let i = sublines.length; i < pool.length; i++) {
    pool[i]!.text.visible = false;
  }
  // Each subline is its own row stacked downward from y=0.
  for (let i = 0; i < sublines.length; i++) {
    const item = pool[i]!;
    if (item.text.text !== sublines[i]!.text) item.text.text = sublines[i]!.text;
    item.text.tint = sublines[i]!.tint;
    item.text.visible = true;
    item.text.position.set(0, i * CHIP_ROW_HEIGHT);
  }
}

// ============================================================================
// Public surface
// ============================================================================

export type DragKind = 'launch' | 'redirect' | 'pirate-retarget';
export interface DragHoverInfo {
  /** Which interaction is producing the hover (drives preview content). */
  readonly drag: DragKind;
  /** ID of the entity issuing the drag (outpost or sub depending on `drag`). */
  readonly sourceId: number;
  /** What the cursor is over right now. `null` when over empty space. */
  readonly target:
    | { kind: 'outpost'; id: OutpostId }
    | { kind: 'sub'; id: SubId }
    | null;
  /** Cursor screen position in CSS pixels (canvas-relative). */
  readonly cursor: { sx: number; sy: number };
  /** True when the gesture commits nothing on release — used for the
   *  "what if" planning drag from an enemy sub. Drives the
   *  PREVIEW label in the tooltip. */
  readonly previewOnly: boolean;
}

interface PixiMapProps {
  world: World;
  activePlayerId: PlayerId;
  selectedOutpostId: OutpostId | null;
  onTapOutpost: (id: OutpostId) => void;
  /** Tap landed on a cluster of overlapping outposts (≥2 unique ids
   *  within hit radius). When provided, replaces onTapOutpost for
   *  ambiguous taps so the App can render a small picker letting the
   *  user choose which outpost they meant. The cursor coord is the
   *  release position (used to anchor the popover). When `undefined`,
   *  the closest hit just falls through to onTapOutpost. */
  onTapCluster?: (
    ids: OutpostId[],
    cursor: { sx: number; sy: number },
  ) => void;
  onTapSub: (id: SubId, screenX: number, screenY: number) => void;
  onDragLaunch: (sourceId: OutpostId, destId: OutpostId) => void;
  /** Drag from an outpost that has a Pirate aboard, dropped on an
   *  enemy sub (rather than an outpost). Caller opens the launch
   *  sheet with the Pirate auto-boarded and the target sub pre-set.
   *  Optional — if undefined, drops on subs fall back to opening the
   *  source outpost sheet (the current default behaviour). */
  onDragLaunchPirate?: (sourceId: OutpostId, targetSubId: SubId) => void;
  /** Drag from a Navigator-carrying sub to an outpost to redirect it. */
  onDragRedirect?: (subId: SubId, destId: OutpostId) => void;
  /** Drag from a Pirate-carrying in-flight sub onto an enemy sub to
   *  retarget the chase. Wired through the same drag-redirect
   *  interaction; on drop, the handler picks outpost-vs-sub by what
   *  the cursor is over. */
  onDragRetargetPirate?: (subId: SubId, targetSubId: SubId) => void;
  /** Fires as the cursor moves during any drag interaction. The
   *  payload reports what target (outpost / sub / none) the pointer
   *  is currently over plus the cursor's screen position, so the
   *  caller can render a live combat-preview tooltip. */
  onDragHover?: (info: DragHoverInfo | null) => void;
  onDragChange?: (active: boolean) => void;
  /** Tap on empty map space — caller typically deselects/closes sheets. */
  onTapEmpty?: () => void;
  /** Double-tap (touch) — caller typically calls `fitAll()` to reframe. */
  onDoubleTap?: () => void;
  /**
   * Drag-to-scrub planning preview. While the user holds a drag from
   * an outpost (drag-launch) or one of their own Navigator-carrying
   * subs (drag-redirect), this fires with the **offset in ms** from
   * the current live sim time to the projected arrival of a sub on
   * the current trajectory. Caller wires this to the scrubber as
   * `setScrubAnchorAt(liveWorld.time + offsetMs)`.
   *
   * Why an offset (not an absolute sim time)? PixiMap only has the
   * *scrubbed* world (the one it renders), not the live one. If we
   * computed `arrivalAt = scrubbedWorld.time + travel`, every emit
   * would compound on the previous scrub — producing a quadratic
   * blow-up of the arrival time as the cursor moved. Returning a
   * pure offset and letting the caller add it to live makes the
   * math linear in cursor distance.
   *
   * Called with `null` on drag end (whether launched, cancelled, or
   * landed on empty) so the scrubber snaps back to live.
   */
  onDragScrub?: (
    offsetMs: number | null,
    cursor?: { sx: number; sy: number } | null,
  ) => void;
  /** Idle pointer entered/left a sub blip. Fires with `null` when the
   *  pointer leaves; with `{subId, cursor}` while hovering. Used by
   *  the App to render an ETA tooltip near the cursor. Only fires when
   *  no drag/pan is in progress so the tooltip doesn't compete with
   *  the drag-launch overlay. */
  onHoverSub?: (
    payload: { subId: SubId; cursor: { sx: number; sy: number } } | null,
  ) => void;
  threats: Map<OutpostId, { etaMs: number; subId: SubId }>;
}

export interface PixiMapHandle {
  fitAll(): void;
  centerOn(outpostId: OutpostId): void;
  /** Center on an arbitrary world coordinate (used by the events
   *  sheet's "jump to location" affordance for events that don't
   *  carry an outpost id — e.g. mid-route sub-vs-sub combats). */
  centerOnPos(pos: { x: number; y: number }): void;
  /** Zoom & center to fit a subset of outposts within the viewport
   *  with padding. Used by the cluster picker's "zoom in" action so
   *  the user can see the overlapping outposts separated. */
  fitOutposts(ids: readonly OutpostId[]): void;
  zoomBy(delta: number): void;
  /** Trigger a short attention-grabbing pulse at a world coordinate.
   *  If a `to` point is given, also draws a fading tracer line from
   *  the pulse to the target and a second pulse at the target — used
   *  for sentry shots. The `kind` controls colour + radius so combat
   *  reads as "orange flash", martyr-blasts as a wide red shockwave,
   *  and info events as the default phosphor ping. */
  pulseAt(
    x: number,
    y: number,
    to?: { x: number; y: number },
    kind?: PulseKind,
  ): void;
}

export type PulseKind = 'info' | 'combat' | 'martyr';

// ============================================================================
// Camera math
// ============================================================================

interface Camera {
  zoom: number;
  panX: number;
  panY: number;
}

function clampZoom(z: number): number {
  if (z < MIN_ZOOM) return MIN_ZOOM;
  if (z > MAX_ZOOM) return MAX_ZOOM;
  return z;
}

function viewportSize(app: Application): { w: number; h: number } {
  // Use CSS pixel dimensions for camera math so the fit/center calculations
  // line up with pointer events and on-screen positions. `app.renderer.width`
  // returns the backbuffer size in physical pixels which, on high-DPR
  // displays (and some headless chromium configs), is a multiple of the CSS
  // size even when resolution is reported as 1.
  const canvas = app.canvas;
  const w = canvas.clientWidth || canvas.width / app.renderer.resolution;
  const h = canvas.clientHeight || canvas.height / app.renderer.resolution;
  return { w, h };
}

function worldToScreen(c: Camera, x: number, y: number): { sx: number; sy: number } {
  return { sx: x * c.zoom + c.panX, sy: y * c.zoom + c.panY };
}

function screenToWorld(c: Camera, sx: number, sy: number): Coord {
  return { x: (sx - c.panX) / c.zoom, y: (sy - c.panY) / c.zoom };
}

function zoomAround(c: Camera, sx: number, sy: number, factor: number): void {
  const before = screenToWorld(c, sx, sy);
  const newZoom = clampZoom(c.zoom * factor);
  c.zoom = newZoom;
  c.panX = sx - before.x * newZoom;
  c.panY = sy - before.y * newZoom;
}

/**
 * Snap the camera pan so the world point at the viewport's centre lies
 * in `[0, MAP_SIZE)` on each axis. Because rendering tiles the world,
 * this snap is visually invisible — the screen contents are identical
 * before and after. Used to bound the integer tile keys (`tx, ty`) we
 * generate so panning indefinitely in one direction doesn't grow the
 * tile-node cache unboundedly.
 */
function normalizePan(c: Camera, viewportW: number, viewportH: number): void {
  if (c.zoom <= 0) return;
  const centreWorldX = (viewportW / 2 - c.panX) / c.zoom;
  const centreWorldY = (viewportH / 2 - c.panY) / c.zoom;
  const wrappedX = ((centreWorldX % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;
  const wrappedY = ((centreWorldY % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;
  c.panX += (centreWorldX - wrappedX) * c.zoom;
  c.panY += (centreWorldY - wrappedY) * c.zoom;
}

function focusCamera(app: Application, p: Coord, zoom: number): Camera {
  const { w, h } = viewportSize(app);
  return { zoom, panX: w / 2 - p.x * zoom, panY: h / 2 - p.y * zoom };
}

// Visual reserves matching the HUD bar at the top and the scrubber strip
// at the bottom. fitAll uses these so outposts at the map edges don't
// disappear under those overlays.
const FIT_RESERVE_TOP_PX = 60;
const FIT_RESERVE_BOTTOM_PX = 60;

interface TileOffset {
  tx: number;
  ty: number;
}

/**
 * Integer tile offsets whose MAP_SIZE×MAP_SIZE tile intersects the viewport.
 * The canonical tile is `{tx: 0, ty: 0}`; neighbours are ±1 (or further if
 * the camera is panned away). A small margin is added so an outpost / sub
 * sitting on a tile edge stays drawn until it's clearly off-screen.
 *
 * Capped at MAX_TILES; if the user zooms out far enough to view more tiles
 * than that we silently clamp — the visible window will still look correct,
 * we just stop drawing the tiles that fall outside the cap.
 */
function computeVisibleTiles(
  camera: Camera,
  viewportW: number,
  viewportH: number,
): TileOffset[] {
  const tl = screenToWorld(camera, 0, 0);
  const br = screenToWorld(camera, viewportW, viewportH);
  // Margin in world units — about one outpost icon's worth.
  const margin = OUTPOST_HIT_R / camera.zoom;
  const txMin = Math.floor((tl.x - margin) / MAP_SIZE);
  const txMax = Math.floor((br.x + margin) / MAP_SIZE);
  const tyMin = Math.floor((tl.y - margin) / MAP_SIZE);
  const tyMax = Math.floor((br.y + margin) / MAP_SIZE);
  const out: TileOffset[] = [];
  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      out.push({ tx, ty });
      if (out.length >= MAX_TILES) return out;
    }
  }
  return out;
}

/**
 * Cheap fingerprint of the world state that affects the will-lose
 * preview. Deliberately excludes mid-recharge shield values and per-tick
 * driller increments — those are caught by the time-based fallback.
 * We only care about: which subs exist, and which outposts they're
 * heading into (so that a new launch or a capture forces an immediate
 * recompute).
 */
function makeWillLoseFingerprint(world: World): string {
  let subs = '';
  for (const s of world.subs) {
    subs += `${s.id as unknown as number},`;
  }
  let owners = '';
  for (const o of world.outposts) {
    if (o.ownerId !== null) {
      owners += `${o.id as unknown as number}:${o.ownerId as unknown as number},`;
    }
  }
  return `${subs}/${owners}`;
}

function fitAllCamera(app: Application): Camera {
  const { w, h } = viewportSize(app);
  const usableH = Math.max(120, h - FIT_RESERVE_TOP_PX - FIT_RESERVE_BOTTOM_PX);
  // 92% of the shorter usable dimension — generous fit with a small
  // breathing margin so outposts near the map edge aren't right against
  // the screen edge.
  const zoom = clampZoom((Math.min(w, usableH) * 0.92) / MAP_SIZE);
  // Center horizontally in the full viewport, vertically in the usable
  // band between HUD and scrubber.
  const centerY = FIT_RESERVE_TOP_PX + usableH / 2;
  return {
    zoom,
    panX: w / 2 - (MAP_SIZE / 2) * zoom,
    panY: centerY - (MAP_SIZE / 2) * zoom,
  };
}

/**
 * Fit a subset of points within the viewport with padding. Used by
 * the cluster picker's "zoom in" action — the bounding box is tight
 * to the picked outposts so the user actually sees them separate.
 *
 * Single-point case (or degenerate bbox): just centers and zooms to
 * a reasonable mid-zoom so the user can see local context, since
 * fitting a 0-width box would zoom to MAX.
 */
function fitPointsCamera(app: Application, points: { x: number; y: number }[]): Camera {
  if (points.length === 0) return fitAllCamera(app);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const bboxW = Math.max(1, maxX - minX);
  const bboxH = Math.max(1, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const { w, h } = viewportSize(app);
  const usableH = Math.max(120, h - FIT_RESERVE_TOP_PX - FIT_RESERVE_BOTTOM_PX);
  // Padding: a single point gets ~400-unit framing (mid-zoom on a
  // 10,000-unit map). Larger bboxes use 60% of the viewport (so the
  // cluster sits comfortably with room around it).
  const PAD_FACTOR = 0.6;
  const minSpan = 400; // world units — keeps single-point zooms sane
  const targetW = Math.max(minSpan, bboxW / PAD_FACTOR);
  const targetH = Math.max(minSpan, bboxH / PAD_FACTOR);
  const zoom = clampZoom(Math.min(w / targetW, usableH / targetH));
  const screenCenterY = FIT_RESERVE_TOP_PX + usableH / 2;
  return {
    zoom,
    panX: w / 2 - centerX * zoom,
    panY: screenCenterY - centerY * zoom,
  };
}

// ============================================================================
// Stable nodes
// ============================================================================

class OutpostNode {
  readonly container = new Container();
  private readonly shield = new Graphics();
  private readonly body = new Graphics();
  private readonly queen = new Graphics();
  private readonly reticle = new Graphics();
  private readonly drillers: Text;
  /** Numeric shield value (e.g. "10/20"). Mines have shield like
   *  every other outpost, but the diamond + halo visually competes
   *  with the first shield ring; this label removes that ambiguity. */
  private readonly shieldText: Text;
  private readonly name: Text;
  /** Row of specialist glyphs above the outpost — at-a-glance
   *  who's stationed here without opening the sheet. Rendered as a
   *  bordered chip (bg rect + text) so the row reads as a UI element.
   *  Each specialist gets its OWN chip — easier to read which
   *  specialists are present at a glance than one joined string. */
  private readonly specsContainer = new Container();
  private readonly specChips: ChipItem[] = [];
  /** Row of CAPTIVE glyphs beneath the outpost name. One chip per
   *  original-owner so each captive group reads in its owner's
   *  colour, at low opacity so it doesn't compete with the active
   *  roster above. */
  private readonly captivesContainer = new Container();
  private readonly captiveChips: ChipItem[] = [];
  private captivesKey = '';
  private readonly threat = new Container();
  private readonly threatBg = new Graphics();
  // Tiny status indicator at the upper-left of the glyph. Currently
  // used to flag "factory paused at electrical cap" for the active
  // player's own outposts.
  private readonly statusDot = new Graphics();

  // Diff keys — graphics are only re-issued when these change.
  private bodyKey = '';
  private shieldKey = '';
  private reticleKey = '';
  private queenShown = false;
  private threatEta = -1;
  private nameValue = '';
  private nameFill = TEXT_DIM;
  private drillersValue = -1;
  private shieldTextKey = '';
  private specsKey = '';
  private statusDotShown = false;
  /** Last applied container.alpha — used by the reachable-range dim
   *  during launch picker. */
  private lastDimAlpha = 1;

  constructor() {
    this.drillers = new Text({ text: '', style: DRILLERS_STYLE });
    this.shieldText = new Text({ text: '', style: SHIELD_STYLE });
    this.name = new Text({ text: '', style: NAME_STYLE });

    this.queen.visible = false;
    this.reticle.visible = false;
    this.drillers.visible = false;
    this.shieldText.visible = false;
    this.specsContainer.visible = false;
    this.captivesContainer.visible = false;
    this.captivesContainer.alpha = 0.55;
    this.threat.visible = false;

    // Threat halo — a simple red ring drawn at the body's centre when
    // an inbound enemy sub is pending. Position is (0,0) since the
    // halo is concentric with the outpost body; the old upper-right
    // text-badge layout is gone (threat lane carries ETA/count now).
    this.threat.position.set(0, 0);
    this.threat.addChild(this.threatBg);

    this.statusDot.visible = false;
    // Anchored at body centre (0,0). The ring around the body is
    // concentric; no corner-offset like the old paused-dot needed.
    this.statusDot.position.set(0, 0);

    this.container.addChild(
      this.shield,
      this.body,
      this.queen,
      this.reticle,
      this.drillers,
      this.shieldText,
      this.specsContainer,
      this.name,
      this.captivesContainer,
      this.threat,
      this.statusDot,
    );
  }

  update(
    o: Outpost,
    isSelected: boolean,
    isLaunchSource: boolean,
    threat: { etaMs: number } | null,
    /** @deprecated retained on the API for caller stability — the
     *  on-map paused-factory ring was removed (HUD shows capped). */
    _isPausedFactory: boolean,
    zoom: number,
    _now: number,
    /** @deprecated — queen-here gold dot was removed; the specialist
     *  chip row already surfaces the queen. Kept for API stability. */
    _queenHere: boolean,
    liveShield: number,
    liveShieldMax: number,
    isPickerTarget: boolean,
    /** Full list of specialist glyphs at this outpost. No truncation
     *  — `layoutChipRow` wraps to multiple rows above the body when
     *  the list exceeds CHIP_ROW_MAX. */
    specGlyphs: readonly string[],
    /**
     * Container alpha in [0,1] — set to <1 during the launch picker
     * to dim outposts that are out of "near tactical reach" from the
     * source. The dim applies to the whole node (body, name, specs,
     * everything) so the eye groups it out without losing identity.
     */
    dimAlpha: number,
    /** Captives held at this outpost, grouped by original owner.
     *  Rendered as a dim row beneath the outpost name, one chip per
     *  owner colour so the player can see whose specialists they're
     *  holding without opening the sheet. */
    captiveGroups: ReadonlyArray<{ ownerId: number; glyphs: string[] }>,
  ): void {
    if (dimAlpha !== this.lastDimAlpha) {
      this.lastDimAlpha = dimAlpha;
      this.container.alpha = dimAlpha;
    }
    const isFogged = o.fogged === true;
    const isDormant = o.ownerId === null;
    const color = playerColor(o.ownerId);

    // Body — kind glyph per the spec (factory=triangle, generator=circle,
    // mine=diamond). Fogged renders as a small dim dot.
    const bodyKey = `${o.kind}|${o.ownerId ?? 'd'}|${isFogged ? 'f' : 'v'}`;
    if (bodyKey !== this.bodyKey) {
      this.bodyKey = bodyKey;
      this.body.clear();
      const r = OUTPOST_R;
      if (isFogged) {
        const dotR = r * 0.75;
        const fillA = isDormant ? 0.5 : 0.85;
        const ringA = isDormant ? 0.35 : 0.55;
        this.body.circle(0, 0, dotR).fill({ color, alpha: fillA });
        this.body
          .circle(0, 0, dotR + 2)
          .stroke({ width: 1, color, alpha: ringA });
      } else {
        // Bioluminescent bloom under every LIVE (player-owned) glyph —
        // three stacked soft discs in the owner colour. Dormant
        // outposts get no bloom: the live/inert hierarchy should read
        // before any shape does. Baked into the same keyed redraw, so
        // it costs nothing at idle.
        if (!isDormant) {
          this.body.circle(0, 0, r * 2.3).fill({ color, alpha: 0.05 });
          this.body.circle(0, 0, r * 1.7).fill({ color, alpha: 0.07 });
          this.body.circle(0, 0, r * 1.25).fill({ color, alpha: 0.09 });
        }
        if (o.kind === 'factory') {
          const h = r * 1.05;
          // Upward-pointing equilateral triangle.
          const tri = [0, -h, h * 0.866, h * 0.55, -h * 0.866, h * 0.55];
          if (isDormant) {
            // Hollow: claimable but inert.
            this.body
              .poly(tri)
              .stroke({ width: 1.4, color, alpha: 0.75 });
            this.body.circle(0, r * 0.05, 1.8).fill({ color, alpha: 0.6 });
          } else {
            this.body
              .poly(tri)
              .fill({ color, alpha: 1 })
              .stroke({ width: 1, color, alpha: 1 });
          }
        } else if (o.kind === 'generator') {
          if (isDormant) {
            this.body
              .circle(0, 0, r)
              .stroke({ width: 1.4, color, alpha: 0.75 });
            this.body.circle(0, 0, 1.8).fill({ color, alpha: 0.6 });
          } else {
            this.body.circle(0, 0, r).fill({ color, alpha: 1 });
            // Subtle inner dot for visual weight on the solid disc.
            this.body
              .circle(0, 0, r * 0.35)
              .fill({ color: BG_DEEP, alpha: 0.3 });
          }
        } else {
          // mine — rotated square (diamond).
          const a = isDormant ? 0.7 : 1.0;
          // Global-visibility halo — a faint always-on ring at 1.5×R
          // around every mine, regardless of viewer sonar. Communicates
          // the "mines are common knowledge" rule without needing the
          // sheet to explain it. Drawn FIRST so the diamond + center
          // pip render on top.
          this.body
            .circle(0, 0, r * 1.5)
            .stroke({ width: 0.8, color, alpha: 0.18 });
          this.body
            .poly([0, -r, r, 0, 0, r, -r, 0])
            .fill({ color, alpha: 0.25 * a })
            .stroke({ width: 1.6, color, alpha: a });
          this.body.circle(0, 0, Math.max(2, r * 0.22)).fill({ color, alpha: a });
        }
      }
    }

    // Shield rings — one ring per 10 charge points, plus a partial
    // arc on the next slot showing in-progress recharge. The cap is
    // dynamic: base 10/20 plus Queen +20, Security Chief +10/SC + 10
    // local, King ±20 etc. Caller passes the live `liveShield` and
    // `liveShieldMax` so the rings reflect the current ceiling. We
    // still cap the *rendered* ring count at 4 to keep the icon
    // readable for absurd shield stacks.
    const visibleRings = isFogged ? 0 : Math.min(4, Math.ceil(liveShield / 10));
    // Outer radius the glyph "occupies" on screen. This must include
    // anything drawn outside the body (shield rings + paused-factory
    // ring + threat halo) so the name, drillers, and specialist chips
    // can be laid out *outside* this shell without overlapping.
    const ringStep = 4;
    const shieldOuterR =
      visibleRings > 0 ? OUTPOST_R + 5 + (visibleRings - 1) * ringStep : OUTPOST_R;
    // Threat halo is at OUTPOST_R + 8 (paused-factory ring removed).
    const halosR = threat !== null ? OUTPOST_R + 8 : 0;
    const outerR = Math.max(shieldOuterR, halosR);
    const maxRings = Math.min(4, Math.max(1, Math.ceil(liveShieldMax / 10)));
    const cappedCharge = isFogged ? 0 : Math.min(maxRings * 10, liveShield);
    const shieldKey = isFogged ? '' : `${cappedCharge}|${maxRings}`;
    if (shieldKey !== this.shieldKey) {
      this.shieldKey = shieldKey;
      this.shield.clear();
      for (let i = 0; i < maxRings; i++) {
        const rangeStart = i * 10;
        if (cappedCharge <= rangeStart) break;
        const radius = OUTPOST_R + 5 + i * 4;
        const remaining = cappedCharge - rangeStart;
        const baseAlpha = 0.85 - i * 0.12;
        if (remaining >= 10) {
          this.shield
            .circle(0, 0, radius)
            .stroke({ width: 1.2, color: SHIELD_STROKE, alpha: baseAlpha });
        } else {
          // Partial arc — grows clockwise from 12 o'clock.
          const frac = remaining / 10;
          const startA = -Math.PI / 2;
          const endA = startA + frac * Math.PI * 2;
          this.shield
            .arc(0, 0, radius, startA, endA)
            .stroke({
              width: 1.2,
              color: SHIELD_STROKE,
              // Fainter than a full ring so the eye reads it as
              // "in progress, not yet complete".
              alpha: baseAlpha * 0.75,
            });
        }
      }
    }

    // Queen-here on-map glyph REMOVED — the queen now appears in the
    // specialist chip row (`[♛, …]`) above the outpost, which is the
    // authoritative "what's stationed here" signal. The separate
    // gold dot was redundant and visually noisy at small zoom.
    if (this.queenShown) {
      this.queenShown = false;
      this.queen.clear();
      this.queen.visible = false;
    }

    // Reticle: phosphor for "launch source", white for "selected",
    // dim phosphor ring for "valid picker target" (low-contrast so
    // it doesn't compete with the active selection).
    let reticleKey = '';
    if (isLaunchSource) reticleKey = 'launch';
    else if (isSelected) reticleKey = 'select';
    else if (isPickerTarget) reticleKey = 'target';
    if (reticleKey !== this.reticleKey) {
      this.reticleKey = reticleKey;
      this.reticle.clear();
      this.reticle.visible = reticleKey !== '';
      if (reticleKey === 'launch') {
        drawReticle(this.reticle, OUTPOST_R + 10, PHOS);
      } else if (reticleKey === 'select') {
        drawReticle(this.reticle, OUTPOST_R + 10, SELECT_WHITE);
      } else if (reticleKey === 'target') {
        this.reticle
          .circle(0, 0, OUTPOST_R + 8)
          .stroke({ width: 1, color: PHOS, alpha: 0.5 });
      }
    }

    // Drillers number — hidden when fogged / dormant / zero, and also
    // suppressed at low zoom so a fit-to-map view stays uncluttered.
    // Pushed outside the outermost shield/halo ring (`outerR`) so a
    // fully-shielded outpost doesn't have its garrison number eaten
    // by ring strokes.
    const drillersShown =
      !isFogged && !isDormant && o.drillers > 0 && zoom >= DRILLERS_VISIBLE_ZOOM;
    if (drillersShown) {
      if (this.drillersValue !== o.drillers) {
        this.drillersValue = o.drillers;
        this.drillers.text = String(o.drillers);
      }
      this.drillers.visible = true;
      // Place along the 45°-up-right diagonal at outer-shell + gap.
      const r = outerR + 10;
      this.drillers.x = r * 0.707;
      this.drillers.y = -r * 0.707;
    } else {
      this.drillers.visible = false;
      this.drillersValue = -1;
    }

    // Shield value (numeric) — shown for any non-fogged, non-dormant
    // outpost. The rings encode the same info visually, but on mines
    // the diamond shape + global halo competes with ring readability,
    // so a number eliminates the ambiguity. Format: "current/max"
    // when partial, or just "max" when fully charged.
    const shieldShown =
      !isFogged && !isDormant && liveShieldMax > 0 && zoom >= DRILLERS_VISIBLE_ZOOM;
    if (shieldShown) {
      const curr = Math.round(liveShield);
      const max = Math.round(liveShieldMax);
      const label = curr >= max ? `${max}` : `${curr}/${max}`;
      const sKey = `${label}`;
      if (sKey !== this.shieldTextKey) {
        this.shieldTextKey = sKey;
        this.shieldText.text = label;
      }
      this.shieldText.visible = true;
      // Mirror of the drillers placement — upper-LEFT diagonal.
      const r = outerR + 8;
      this.shieldText.x = -r * 0.707 - this.shieldText.width;
      this.shieldText.y = -r * 0.707;
    } else {
      this.shieldText.visible = false;
      this.shieldTextKey = '';
    }

    // Specialist glyph row — rendered as a bordered chip above the
    // outpost so the row is unambiguously "this is the roster" instead
    // of free-floating text colliding with the garrison number / name
    // label. Hidden when fogged (no sonar = no roster knowledge).
    //
    // Border color = the OUTPOST OWNER's color. Lets a player tell
    // "my queen" from "their queen" at a glance instead of every
    // chip on every outpost reading as phos.
    const ownerColor = isDormant ? 0x4a5874 : playerColor(o.ownerId!);
    const specsKey = `${ownerColor.toString(16)}|${specGlyphs.join('·')}`;
    const specsShown = !isFogged && specGlyphs.length > 0;
    if (specsShown) {
      if (this.specsKey !== specsKey) {
        this.specsKey = specsKey;
        layoutChipRow(
          this.specsContainer,
          this.specChips,
          specGlyphs,
          ownerColor,
          SPECS_STYLE,
          { gap: 2 },
        );
      }
      this.specsContainer.visible = true;
      // Position the row centre OUTSIDE the outermost ring (shield +
      // halos) so chips never overlap the rings. Margin chosen so the
      // bracketed text breathes from the outer ring rather than
      // touching it.
      this.specsContainer.position.set(0, -outerR - 12);
    } else {
      this.specsContainer.visible = false;
      this.specsKey = '';
    }

    // Name label — hidden below the LOD threshold so a fit-to-map view
    // shows only glyphs, not text. Discovered outposts retain identity
    // (dimmed style) when shown. The toUpperCase() result is cached by
    // raw name since outpost names never change after world-gen — skips
    // ~360 string allocations per frame in steady state.
    this.name.visible = zoom >= NAME_VISIBLE_ZOOM;
    if (o.name !== this.nameValue) {
      this.nameValue = o.name;
      this.name.text = o.name.toUpperCase();
    }
    const desiredFill = isFogged ? TEXT_MUTE : isDormant ? TEXT_MUTE : TEXT_DIM;
    if (desiredFill !== this.nameFill) {
      this.nameFill = desiredFill;
      this.name.style.fill = desiredFill;
    }
    this.name.x = -this.name.width / 2;
    // Name sits below the outer-shell radius so it never overlaps
    // shield rings or paused-factory/threat halos.
    this.name.y = outerR + 6;

    // Captives — render BELOW the name in dim group-chips coloured
    // by the original owner. Hidden when fogged (no roster info) or
    // when there are no captives. Diff-keyed on the same join string
    // we'd compute anyway, so the layout call only fires on change.
    const captivesShown = !isFogged && captiveGroups.length > 0;
    const captivesKey = captivesShown
      ? captiveGroups
          .map((g) => `${g.ownerId}:${g.glyphs.join(',')}`)
          .join('|')
      : '';
    if (captivesShown) {
      if (this.captivesKey !== captivesKey) {
        this.captivesKey = captivesKey;
        layoutCaptiveRow(
          this.captivesContainer,
          this.captiveChips,
          captiveGroups,
          SPECS_STYLE,
        );
      }
      this.captivesContainer.visible = true;
      // Sit below the NAME (not the outer ring — name already sits
      // below outer). Name baseline is at outerR + 6 with ~10 px text
      // height; an extra ~16 px gap below the name keeps the captive
      // row from kissing the name.
      this.captivesContainer.position.set(0, outerR + 6 + 22);
    } else {
      this.captivesContainer.visible = false;
      this.captivesKey = '';
    }

    // Paused-factory indicator — small red DOT just outside the
    // outer ring shell, drawn for FACTORIES owned by the active
    // player when they're at electrical cap. (Capped factories
    // produce nothing — the dot is the signal to spend drillers.)
    // Red dot (not orange ring): smaller visual footprint, doesn't
    // overlap shield rings since it sits OUTSIDE `outerR`.
    if (_isPausedFactory !== this.statusDotShown) {
      this.statusDotShown = _isPausedFactory;
      this.statusDot.clear();
      if (_isPausedFactory) {
        // Place at 5-o'clock (lower-right) so the dot doesn't overlap
        // the specialist chip row above the body or the name label
        // directly below. Sits just outside the outer ring shell.
        const r = outerR + 5;
        this.statusDot.position.set(r * 0.707, r * 0.707);
        this.statusDot
          .circle(0, 0, 2)
          .fill({ color: 0xff5470, alpha: 1 });
        this.statusDot.visible = true;
      } else {
        this.statusDot.visible = false;
      }
    }

    // Threat indicator — replaced the old text badge ("⚔ 8h") with a
    // pre-attentive red halo. The threat *lane* is now the single
    // source of "you have inbound subs" (count + ETA + outcome per
    // row). The on-outpost halo just answers "which outpost on the
    // map?" — useful when the player taps a lane row and the camera
    // centres but the eye still needs to land on the target.
    //
    // A simple red ring at body+8 is cheap to redraw on enter/leave
    // and reads against any outpost colour. No animation (let the
    // lane row's pulse carry the urgency).
    const showThreat = threat !== null;
    const threatShown = this.threatEta >= 0;
    if (showThreat !== threatShown) {
      this.threatEta = showThreat ? 1 : -1; // re-use as boolean flag
      this.threatBg.clear();
      if (showThreat) {
        // Red halo at 1.4×R — sits outside the shield rings but inside
        // typical glyph clutter. Strong enough to find by eye but
        // doesn't dominate like a filled badge.
        this.threatBg
          .circle(0, 0, OUTPOST_R + 8)
          .stroke({ width: 1.5, color: THREAT_RED, alpha: 0.85 });
        this.threat.visible = true;
      } else {
        this.threat.visible = false;
      }
    }
  }

  private lastSx = Number.NaN;
  private lastSy = Number.NaN;

  setScreen(sx: number, sy: number): void {
    // Skip the Pixi transform invalidation when position hasn't moved.
    // Outpost screen positions only change with camera or world tile,
    // so on a steady-state frame this short-circuits 40 × ~9 = 360
    // no-op calls.
    if (sx === this.lastSx && sy === this.lastSy) return;
    this.lastSx = sx;
    this.lastSy = sy;
    this.container.position.set(sx, sy);
  }

  setVisible(v: boolean): void {
    if (this.container.visible !== v) this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

class SubNode {
  readonly container = new Container();
  private readonly blip = new Graphics();
  private readonly drillers: Text;
  /** Specialist-glyph row alongside the hull — each specialist is its
   *  OWN bordered chip (not one joined string). Reuses `layoutChipRow`
   *  so the layout matches outposts. */
  private readonly specsContainer = new Container();
  private readonly specChips: ChipItem[] = [];
  private lastLabel = '';
  private lastSpecsKey = '';
  // Hull geometry is invariant across the sub's life: the heading angle
  // is fixed at launch and the owner doesn't change. Cache the draw so
  // per-frame motion only repositions the container, not the polygon.
  private hullKey = '';

  constructor() {
    this.drillers = new Text({ text: '', style: SUB_LABEL_STYLE });
    this.drillers.visible = false;
    this.specsContainer.visible = false;
    this.container.addChild(this.blip, this.drillers, this.specsContainer);
  }

  update(
    sub: Sub,
    angle: number,
    zoom: number,
    queued = false,
    willLose = false,
    /** One glyph per specialist aboard (with an optional trailing
     *  "+N" overflow). Rendered as a row of individual chip-pills. */
    specGlyphs: readonly string[] = EMPTY_SPECS,
    /** True iff the sub's owner is also the destination owner — i.e.
     *  they're moving drillers between their own outposts. Renders a
     *  small phos pip inside the conning tower so a viewer can tell
     *  "they're consolidating" from "they're attacking" at a glance. */
    isReinforce = false,
    /** Pre-launch only: ms until the sub actually departs. Drives the
     *  countdown label that makes "pending order" explicit on the map. */
    queuedRemainingMs = 0,
  ): void {
    const color = playerColor(sub.ownerId);
    // Include `queued` in the hull key so we redraw with/without the
    // pending-outline halo when status flips at launch time.
    const hullKey = `${sub.ownerId}|${angle.toFixed(2)}|${willLose ? 'L' : '_'}|${isReinforce ? 'R' : '_'}|${queued ? 'Q' : '_'}`;
    if (hullKey !== this.hullKey) {
      this.hullKey = hullKey;
      this.redrawHull(angle, color, willLose, isReinforce, queued);
    }
    // Pre-launch subs render with reduced opacity AND a pulsing
    // dashed halo drawn by redrawHull. Both together read as
    // "scheduled, not yet launched."
    this.container.alpha = queued ? 0.7 : 1;

    // Pre-launch (queued) subs sit on top of their source outpost; the
    // driller-count label there collides with the source outpost's own
    // label. Instead they show a LAUNCH COUNTDOWN above the hull —
    // "pending, departs in X" — which is the one fact that matters
    // during the cancel window. Tap the sub for the cargo details.
    if (queued) {
      const label = `launch ${formatEta(queuedRemainingMs)}`;
      if (this.lastLabel !== label) {
        this.lastLabel = label;
        this.drillers.text = label;
      }
      this.drillers.visible = true;
      this.drillers.x = -this.drillers.width / 2;
      this.drillers.y = -34 - this.drillers.height / 2;
    } else if (sub.drillers > 0 && zoom >= DRILLERS_VISIBLE_ZOOM) {
      // Speed factor rides along with the driller count when boosted
      // (Helmsman/Smuggler/Admiral/pirate-return). 1× subs stay clean —
      // the exact figure for any sub lives in its popover sheet.
      const label =
        sub.speedMultiplier !== 1
          ? `${sub.drillers} ${formatSpeed(sub.speedMultiplier)}×`
          : String(sub.drillers);
      if (this.lastLabel !== label) {
        this.lastLabel = label;
        this.drillers.text = label;
      }
      this.drillers.visible = true;
      // Perpendicular offset so the label sits beside the hull, not on
      // top of the arrow itself. Bumped from 12 → 18 so the drillers
      // number stays clear of the hull edges at the bigger sub icon
      // and doesn't visually merge with the bow/stern triangles.
      const offset = 18;
      const lx = -Math.sin(angle) * offset;
      const ly = Math.cos(angle) * offset;
      this.drillers.x = lx - this.drillers.width / 2;
      this.drillers.y = ly - this.drillers.height / 2;
    } else {
      this.drillers.visible = false;
      this.lastLabel = '';
    }

    // Specialist row alongside the hull. Each specialist gets its
    // own bordered chip via `layoutChipRow` — same helper outposts
    // use — so 3 chips visually read as "3 distinct things aboard"
    // rather than "one chip with 3 glyphs".
    if (!queued && specGlyphs.length > 0) {
      const ownerColor = playerColor(sub.ownerId);
      const specsKey = `${ownerColor.toString(16)}|${specGlyphs.join('·')}`;
      if (this.lastSpecsKey !== specsKey) {
        this.lastSpecsKey = specsKey;
        layoutChipRow(
          this.specsContainer,
          this.specChips,
          specGlyphs,
          ownerColor,
          SPECS_SUB_STYLE,
          { gap: 1 },
        );
      }
      this.specsContainer.visible = true;
      // Place the row on the OPPOSITE side of the hull from the
      // driller count so the two labels don't collide. Larger
      // perpendicular offset (-22 instead of -14) accounts for the
      // bigger bracket text style + the wider `[a,b,c]` strings that
      // can occur when multiple specialists board the same sub.
      const offset = -22;
      const lx = -Math.sin(angle) * offset;
      const ly = Math.cos(angle) * offset;
      this.specsContainer.position.set(lx, ly);
    } else {
      this.specsContainer.visible = false;
      this.lastSpecsKey = '';
    }
  }

  private lastSx = Number.NaN;
  private lastSy = Number.NaN;

  setScreen(sx: number, sy: number): void {
    if (sx === this.lastSx && sy === this.lastSy) return;
    this.lastSx = sx;
    this.lastSy = sy;
    this.container.position.set(sx, sy);
  }

  setVisible(v: boolean): void {
    if (this.container.visible !== v) this.container.visible = v;
  }

  /**
   * Issue the hull / wake / tower / bow-light geometry. Called only on
   * hull-key change (owner or heading). Pixi rotates the whole Graphics
   * via `blip.rotation` so per-frame motion doesn't re-bake polygons.
   */
  private redrawHull(
    angle: number,
    color: number,
    willLose = false,
    isReinforce = false,
    queued = false,
  ): void {
    this.blip.clear();
    this.blip.rotation = angle;

    // Queued/pending sub: draw a red dashed halo around the SOURCE
    // outpost (radius well outside its shield rings) so "this outpost
    // has a sub waiting to launch" reads pre-attentively. The hull
    // itself stays compact at the centre — the halo is what tells
    // you it's pending. Halo is unrotated (the `arc()` calls are
    // baked into `this.blip` which rotates with the sub, but a full
    // circle is rotation-invariant, so visually it stays put).
    if (queued) {
      const R = 30;
      const segs = 14;
      for (let i = 0; i < segs; i += 2) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        this.blip
          .arc(0, 0, R, a0, a1)
          .stroke({ width: 1.5, color: 0xff5470, alpha: 0.85 });
      }
    }

    // Submarine top-down silhouette: cigar-shaped hull (pointed bow,
    // rounded stern) with a conning tower mid-deck. Directional —
    // bow points along the heading.
    //
    //   bow →  ╱───────────────╮
    //          │     ┌──┐       │  ← conning tower
    //          ╲───────────────╯
    //                                stern
    // Simple directional triangle — clean, readable at all zooms,
    // unmistakable as "this thing is moving and it's going THAT way."
    // Bow at +L, stern flat at -L*0.6. Owner-colour fill + white rim.
    const L = 9;
    const W = 5;
    // Bioluminescent halo under the hull — matches the owned-outpost
    // bloom so "live friendly/hostile hardware" shares one visual
    // grammar. Circles are rotation-invariant, so the per-frame
    // rotation stays free.
    this.blip.circle(0, 0, L * 1.6).fill({ color, alpha: 0.07 });
    this.blip.circle(0, 0, L * 1.05).fill({ color, alpha: 0.1 });
    this.blip
      .moveTo(L, 0)              // bow point
      .lineTo(-L * 0.6, -W)      // port stern corner
      .lineTo(-L * 0.4, 0)       // small notch in stern (so it reads "arrow", not "triangle")
      .lineTo(-L * 0.6, W)       // starboard stern corner
      .closePath()
      .fill({ color, alpha: 1 })
      .stroke({ width: 1, color: 0xffffff, alpha: 0.85 });

    // Reinforce pip — small phos disc just inside the bow notch for
    // subs whose owner == destination owner. Signals "consolidating"
    // independent of hull colour.
    if (isReinforce) {
      this.blip
        .circle(-L * 0.05, 0, 1.6)
        .fill({ color: PHOS, alpha: 0.95 });
    }

    // Will-lose marker — small red dot at the stern, on top of the
    // hull. White stroke keeps it visible against any hull colour.
    if (willLose) {
      this.blip
        .circle(-L * 0.55, 0, 1.8)
        .fill({ color: THREAT_RED, alpha: 1 })
        .stroke({ width: 0.8, color: 0xffffff, alpha: 0.95 });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** `2` for 2.0, `1.5` for 1.5 — drop a trailing `.0` so the map label
 *  stays compact. */
function formatSpeed(mult: number): string {
  return mult.toFixed(1).replace(/\.0$/, '');
}

function drawReticle(g: Graphics, r: number, color: number): void {
  const len = 6;
  g.moveTo(-r, -r + len).lineTo(-r, -r).lineTo(-r + len, -r);
  g.moveTo(r - len, -r).lineTo(r, -r).lineTo(r, -r + len);
  g.moveTo(r, r - len).lineTo(r, r).lineTo(r - len, r);
  g.moveTo(-r + len, r).lineTo(-r, r).lineTo(-r, r - len);
  g.stroke({ width: 1.5, color, alpha: 0.95 });
}

// ============================================================================
// Hit testing
// ============================================================================

interface OutpostHit {
  id: OutpostId;
  // Tile offset of the copy the user is hitting. Several copies of the
  // same outpost may be visible at once when the camera is zoomed out
  // or panned past a seam; we track which copy was clicked so drag-launch
  // can anchor its preview line to the right screen position.
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  r: number;
}

interface SubHit {
  id: SubId;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  r: number;
}

type TopTarget =
  | { kind: 'outpost'; id: OutpostId; tx: number; ty: number }
  | { kind: 'sub'; id: SubId; tx: number; ty: number };

function pickTopTarget(
  outposts: OutpostHit[],
  subs: SubHit[],
  sx: number,
  sy: number,
): TopTarget | null {
  let best: { target: TopTarget; d2: number } | null = null;
  for (const h of outposts) {
    const dx = h.sx - sx;
    const dy = h.sy - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 > h.r * h.r) continue;
    if (!best || d2 < best.d2) {
      best = { target: { kind: 'outpost', id: h.id, tx: h.tx, ty: h.ty }, d2 };
    }
  }
  for (const h of subs) {
    const dx = h.sx - sx;
    const dy = h.sy - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 > h.r * h.r) continue;
    // `<=`, not `<`: ties go to the SUB. A pre-launch sub sits at
    // exactly its source outpost's centre, so strict closest-wins made
    // the outpost (iterated first) eat every tap on the blip — the
    // pre-launch cargo editor was unreachable by touch. Subs render
    // above outposts, so top-most-wins also matches what the eye sees.
    if (!best || d2 <= best.d2) {
      best = { target: { kind: 'sub', id: h.id, tx: h.tx, ty: h.ty }, d2 };
    }
  }
  return best?.target ?? null;
}

/** Closest outpost hit within range of (sx, sy), with its squared
 *  screen distance — so callers can compare against a sub hit and pick
 *  whichever the cursor is genuinely nearest. */
function nearestOutpostHit(
  hits: OutpostHit[],
  sx: number,
  sy: number,
  excludeId: OutpostId | null,
): { id: OutpostId; d2: number } | null {
  let best: OutpostId | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  for (const h of hits) {
    if (excludeId !== null && h.id === excludeId) continue;
    const dx = h.sx - sx;
    const dy = h.sy - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= h.r * h.r && d2 < bestD2) {
      bestD2 = d2;
      best = h.id;
    }
  }
  return best === null ? null : { id: best, d2: bestD2 };
}

function pickOutpost(
  hits: OutpostHit[],
  sx: number,
  sy: number,
  excludeId: OutpostId | null,
): OutpostId | null {
  return nearestOutpostHit(hits, sx, sy, excludeId)?.id ?? null;
}

function pickAllOutposts(
  hits: OutpostHit[],
  sx: number,
  sy: number,
): OutpostId[] {
  // De-duplicate by id — torus tiling means the same outpost may have
  // 9 visible copies at low zoom. The cluster picker should show one
  // entry per unique outpost, not nine. Sort by distance ASC so the
  // tapped-closest entry appears at the top of the picker.
  const seen = new Set<OutpostId>();
  const candidates: { id: OutpostId; d2: number }[] = [];
  for (const h of hits) {
    const dx = h.sx - sx;
    const dy = h.sy - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 > h.r * h.r) continue;
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    candidates.push({ id: h.id, d2 });
  }
  candidates.sort((a, b) => a.d2 - b.d2);
  return candidates.map((c) => c.id);
}

/**
 * Find the closest sub hit within range of (sx, sy). Optional
 * `extraR` widens the snap radius — used by drag flows that need a
 * generous "near sub" detection so the user can target without
 * pixel-perfect placement (the rendered sub blip is only ~12 px wide).
 */
function nearestSubHit(
  hits: SubHit[],
  sx: number,
  sy: number,
  extraR = 0,
  excludeId: SubId | null = null,
): { id: SubId; d2: number } | null {
  let best: SubId | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  const excl =
    excludeId === null ? null : (excludeId as unknown as number);
  for (const h of hits) {
    if (excl !== null && (h.id as unknown as number) === excl) continue;
    const dx = h.sx - sx;
    const dy = h.sy - sy;
    const d2 = dx * dx + dy * dy;
    const r = h.r + extraR;
    if (d2 <= r * r && d2 < bestD2) {
      bestD2 = d2;
      best = h.id;
    }
  }
  return best === null ? null : { id: best, d2: bestD2 };
}

function pickSub(
  hits: SubHit[],
  sx: number,
  sy: number,
  extraR = 0,
  excludeId: SubId | null = null,
): SubId | null {
  return nearestSubHit(hits, sx, sy, extraR, excludeId)?.id ?? null;
}

/** True when the source outpost carries an active Pirate owned by the
 *  active player — i.e. a drag from here can target an enemy sub. */
function sourceHasActivePirate(
  world: World,
  activePlayerId: PlayerId,
  sourceId: OutpostId,
): boolean {
  return world.specialists.some(
    (s) =>
      s.state === 'active' &&
      s.kind === 'pirate' &&
      s.ownerId === activePlayerId &&
      s.location.kind === 'outpost' &&
      (s.location.id as unknown as number) === (sourceId as unknown as number),
  );
}

export type DragLaunchTarget =
  | { kind: 'outpost'; id: OutpostId }
  | { kind: 'sub'; id: SubId };

/**
 * Decide what a drag-launch from `sourceId` is pointing at, shared by
 * the hover affordance, the reticle, and the commit so all three agree.
 *
 * An outpost under the cursor is the target — UNLESS the source has a
 * Pirate aboard and the cursor is at least as close to an enemy sub.
 * Without this tie-break the outpost always won (subs are usually drawn
 * right on top of an outpost), so dropping on a sub silently launched at
 * a nearby outpost and the sub never showed a "droppable" ring.
 */
function resolveDragLaunchTarget(
  outpostHits: OutpostHit[],
  subHits: SubHit[],
  sx: number,
  sy: number,
  sourceId: OutpostId,
  world: World,
  activePlayerId: PlayerId,
): DragLaunchTarget | null {
  const outpost = nearestOutpostHit(outpostHits, sx, sy, sourceId);
  if (sourceHasActivePirate(world, activePlayerId, sourceId)) {
    const subHit = nearestSubHit(subHits, sx, sy, SUB_DRAG_SNAP_EXTRA, null);
    if (subHit !== null) {
      const sub = world.subs.find((s) => s.id === subHit.id);
      const isEnemy = sub !== undefined && sub.ownerId !== activePlayerId;
      if (isEnemy && (outpost === null || subHit.d2 <= outpost.d2)) {
        return { kind: 'sub', id: subHit.id };
      }
    }
  }
  return outpost === null ? null : { kind: 'outpost', id: outpost.id };
}

/** Snap-radius widening for sub targets during a drag. Matches the
 *  outpost drag-snap "feel" — small enough to be unambiguous,
 *  large enough that the user doesn't have to thread a needle. */
const SUB_DRAG_SNAP_EXTRA = 14;

// ============================================================================
// Interaction state machine
// ============================================================================

type Interaction =
  | { kind: 'idle' }
  | {
      kind: 'pan';
      startSx: number;
      startSy: number;
      startPanX: number;
      startPanY: number;
      moved: boolean;
    }
  | {
      kind: 'press-outpost';
      outpostId: OutpostId;
      // Tile copy the user pressed on; the drag-launch rubber-band anchors
      // here so the line starts at the visible icon, not at the canonical
      // tile that may be off-screen.
      sourceTx: number;
      sourceTy: number;
      canDrag: boolean;
      startSx: number;
      startSy: number;
      currentSx: number;
      currentSy: number;
    }
  | {
      kind: 'drag-launch';
      sourceId: OutpostId;
      sourceTx: number;
      sourceTy: number;
      currentSx: number;
      currentSy: number;
      hovered: OutpostId | null;
      /** Enemy sub under the cursor when the source has a Pirate aboard
       *  (mutually exclusive with `hovered` — at most one is set). Drives
       *  the sub-target reticle and the pirate launch on release. */
      hoveredSub: SubId | null;
      /** Whether the active player owned the source at drag-start.
       *  Used to allow the launch sheet to open even if the outpost
       *  changes hands mid-drag due to real-time sim ticking. */
      ownedAtStart: boolean;
    }
  | {
      kind: 'press-sub';
      subId: SubId;
      canDrag: boolean; // Navigator/Pirate aboard
      /** True when the press is on a sub the viewer does not own —
       *  the drag is a "what if" preview only and commits nothing. */
      previewOnly: boolean;
      startSx: number;
      startSy: number;
      currentSx: number;
      currentSy: number;
    }
  | {
      kind: 'drag-redirect';
      subId: SubId;
      /** True for previews of enemy subs — release doesn't commit. */
      previewOnly: boolean;
      anchorSx: number;
      anchorSy: number;
      currentSx: number;
      currentSy: number;
      hovered: OutpostId | null;
    };

// ============================================================================
// Component
// ============================================================================

export const PixiMap = forwardRef<PixiMapHandle, PixiMapProps>(function PixiMap(props, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);

  // Layers
  /** Static bathymetric-chart tile, behind everything. */
  const bathyRef = useRef<TilingSprite | null>(null);
  const sonarRef = useRef<Graphics | null>(null);
  // Fog of war: `fogRef` is a screen-filling dim overlay; `fogMaskRef`
  // is the union of the player's sonar circles, applied to `fogRef` as
  // an INVERSE mask so the dimming shows everywhere EXCEPT inside the
  // player's vision. The mask merges overlapping circles automatically,
  // so the lit area is one joined region with a single crisp border.
  const fogRef = useRef<Graphics | null>(null);
  const fogMaskRef = useRef<Graphics | null>(null);
  const trailLayerRef = useRef<Container | null>(null);
  const pulseLayerRef = useRef<Graphics | null>(null);
  /** Per-pair markers for predicted sub-vs-sub encounters (G10).
   *  Keyed by canonical "minSubId|maxSubId" so a pair gets one
   *  marker regardless of iteration order. */
  const encounterMarkersRef = useRef<
    Map<string, { ring: Graphics; text: Text }>
  >(new Map());
  const pulsesRef = useRef<
    { x: number; y: number; startMs: number; kind: PulseKind }[]
  >([]);
  const tracersRef = useRef<
    { x1: number; y1: number; x2: number; y2: number; startMs: number }[]
  >([]);
  const entityLayerRef = useRef<Container | null>(null);
  const overlayRef = useRef<Graphics | null>(null);

  // Persistent node maps. Keyed by `${entityId}|${tx}|${ty}` so each
  // visible tile copy of an outpost / sub gets its own scene-graph node;
  // a node is destroyed only once its tile drops out of the viewport.
  const outpostNodesRef = useRef<Map<string, OutpostNode>>(new Map());
  const subNodesRef = useRef<Map<string, SubNode>>(new Map());
  const trailGraphicsRef = useRef<Map<string, Graphics>>(new Map());

  // Hit lists (re-baked every render)
  const outpostHitsRef = useRef<OutpostHit[]>([]);
  const subHitsRef = useRef<SubHit[]>([]);
  /** Sub the cursor is hovering. Tracked here so the pointermove
   *  handler can de-dupe to enter/leave events. */
  const lastHoveredSubRef = useRef<SubId | null>(null);

  const cameraRef = useRef<Camera>({ zoom: DEFAULT_ZOOM, panX: 0, panY: 0 });
  const interactionRef = useRef<Interaction>({ kind: 'idle' });
  const resizeObsRef = useRef<ResizeObserver | null>(null);

  // Sim-time interpolation. The server pushes a fresh world snapshot every
  // 500ms; without smoothing, sub blips would jump that interval. We track
  // how much real time has elapsed since the last snapshot and the
  // observed sim-to-real ratio, then advance world.time forward by a
  // fraction of a tick when computing in-flight sub positions.
  const worldRecvAtRef = useRef(Date.now());
  const worldTimeAtRecvRef = useRef(0);
  const simRatioRef = useRef(0); // sim-ms per real-ms; 0 = no extrapolation

  // Cached "will this sub lose its arrival combat?" per visible sub.
  // simulateSubArrival deep-clones the world and projects forward —
  // O(N_subs × world_size) work. We throttle to at most once every
  // WILL_LOSE_REFRESH_MS and additionally skip when a cheap fingerprint
  // of relevant world state (sub IDs/drillers + outpost owners/drillers)
  // hasn't changed since the last sample. The marker is allowed to
  // stay slightly stale — it's a coarse warning, not a tick-precise
  // readout.
  const willLoseRef = useRef<Set<SubId>>(new Set());
  const willLoseLastAtRef = useRef(0);
  const willLoseFingerprintRef = useRef('');

  // Latest props in a ref so pixi callbacks read fresh state without
  // re-mounting the application.
  const propsRef = useRef(props);
  propsRef.current = props;

  // Single render entrypoint — updates scene graph, drag overlay, and
  // triggers a manual pixel render. Computes an interpolated `subTime`
  // ahead of the last server snapshot so sub blips glide smoothly between
  // ticks rather than jumping every 500ms.
  const render = useCallback((): void => {
    const app = appRef.current;
    if (!app) return;
    const world = propsRef.current.world;
    let subTime = world.time;
    if (simRatioRef.current > 0) {
      const realElapsed = Math.max(0, Date.now() - worldRecvAtRef.current);
      // Clamp the extrapolation window so a stalled server can't drift
      // sub positions past their arrival time.
      const simAhead = Math.min(realElapsed * simRatioRef.current, 2000);
      subTime = world.time + simAhead;
    }
    drawScene(
      app,
      propsRef.current,
      cameraRef.current,
      subTime,
      willLoseRef.current,
      {
        bathyRef,
        sonarRef,
        fogRef,
        fogMaskRef,
        trailLayerRef,
        entityLayerRef,
        outpostNodesRef,
        subNodesRef,
        trailGraphicsRef,
        outpostHitsRef,
        subHitsRef,
        interactionRef,
        encounterMarkersRef,
      },
    );
    const overlay = overlayRef.current;
    const inter = interactionRef.current;
    if (overlay && inter.kind === 'drag-launch') {
      drawDragOverlay(
        overlay,
        inter,
        propsRef.current.world,
        cameraRef.current,
        outpostHitsRef.current,
        subHitsRef.current,
      );
    }
    drawPulses(
      pulseLayerRef.current,
      pulsesRef.current,
      tracersRef.current,
      cameraRef.current,
    );
  }, []);

  // Mount Pixi once.
  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    let cancelled = false;

    const app = new Application();
    void app
      .init({
        background: BG_DEEP,
        antialias: true,
        resizeTo: host,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })
      .then(() => {
        if (cancelled) {
          app.destroy(true);
          return;
        }
        host.appendChild(app.canvas);

        // Layer order (back → front):
        //   bathy       — static bathymetric chart tile (drawn once)
        //   fog         — dim "outside vision" overlay (inverse-masked);
        //                 also carries the phosphor sonar-edge band
        //   sonar       — sentry ranges + selected-outpost ring
        //   trailLayer  — sub trails (under outposts)
        //   entityLayer — outpost nodes + sub blips
        //   pulseLayer  — event-driven attention pulses
        //   overlay     — screen-space drag rubber-band
        // Bathy + fog sit at the very back so they only shade the map
        // backdrop — entities and labels render on top at full
        // brightness and stay readable.
        const bathy = buildBathymetry(app);
        const fog = new Graphics();
        const fogMask = new Graphics();
        const sonar = new Graphics();
        const trailLayer = new Container();
        const entityLayer = new Container();
        const pulseLayer = new Graphics();
        const overlay = new Graphics();
        app.stage.addChild(
          bathy,
          fog,
          fogMask,
          sonar,
          trailLayer,
          entityLayer,
          pulseLayer,
          overlay,
        );
        // Inverse mask: `fog` is painted everywhere EXCEPT inside the
        // sonar union drawn into `fogMask`.
        fog.setMask?.({ mask: fogMask, inverse: true });
        app.stage.eventMode = 'static';
        refreshHitArea(app);

        appRef.current = app;
        bathyRef.current = bathy;
        sonarRef.current = sonar;
        fogRef.current = fog;
        fogMaskRef.current = fogMask;
        trailLayerRef.current = trailLayer;
        entityLayerRef.current = entityLayer;
        pulseLayerRef.current = pulseLayer;
        overlayRef.current = overlay;

        attachPointerHandlers(app, {
          cameraRef,
          interactionRef,
          outpostHitsRef,
          subHitsRef,
          overlayRef,
          propsRef,
          render,
          lastHoveredSubRef,
        });

        const ro = new ResizeObserver(() => {
          refreshHitArea(app);
          render();
        });
        ro.observe(host);
        resizeObsRef.current = ro;

        // Per-frame tick — re-render so in-flight sub blips advance
        // smoothly between server snapshots. With nothing in flight this
        // is essentially a no-op: drawScene early-exits on each sub
        // (status !== 'in_flight') and OutpostNode's diff-key cache
        // suppresses any redraws.
        // Per-frame ticker — drives smooth sub motion between the 500 ms
        // server snapshots. We cap the redraw rate to ~30 fps because
        // at any reasonable SIM_SPEED sub blips move sub-pixel per frame
        // anyway, and halving the work materially reduces CPU. The
        // anyInFlight guard skips the loop entirely when nothing's
        // moving (idle map renders 0 frames/sec apart from prop changes).
        const TICKER_INTERVAL_MS = 33; // ~30 fps
        let lastTickerRenderAt = 0;
        app.ticker.add(() => {
          const w = propsRef.current.world;
          const anyFx =
            pulsesRef.current.length > 0 || tracersRef.current.length > 0;
          if (w.subs.length === 0 && !anyFx) return;
          const now = performance.now();
          if (now - lastTickerRenderAt < TICKER_INTERVAL_MS) return;
          let anyInFlight = false;
          for (const sub of w.subs) {
            if (sub.arrivalAt > w.time && sub.launchAt <= w.time) {
              anyInFlight = true;
              break;
            }
          }
          if (!anyInFlight && !anyFx) return;
          lastTickerRenderAt = now;
          render();
        });

        // Initial framing — center on the player's queen if any, at the
        // default zoom; otherwise fit the whole map.
        const queenHomeId = queenOutpostOf(
          propsRef.current.world,
          propsRef.current.activePlayerId,
        );
        const home =
          queenHomeId !== null
            ? propsRef.current.world.outposts.find((o) => o.id === queenHomeId) ?? null
            : null;
        cameraRef.current = home
          ? focusCamera(app, home.pos, DEFAULT_ZOOM)
          : fitAllCamera(app);

        render();
      });

    return () => {
      cancelled = true;
      const ro = resizeObsRef.current;
      if (ro) ro.disconnect();
      resizeObsRef.current = null;
      for (const n of outpostNodesRef.current.values()) n.destroy();
      outpostNodesRef.current.clear();
      for (const n of subNodesRef.current.values()) n.destroy();
      subNodesRef.current.clear();
      for (const g of trailGraphicsRef.current.values()) g.destroy();
      trailGraphicsRef.current.clear();
      const a = appRef.current;
      if (a) a.destroy(true);
      appRef.current = null;
      bathyRef.current = null;
      sonarRef.current = null;
      fogRef.current = null;
      fogMaskRef.current = null;
      trailLayerRef.current = null;
      entityLayerRef.current = null;
      overlayRef.current = null;
      interactionRef.current = { kind: 'idle' };
      outpostHitsRef.current = [];
      subHitsRef.current = [];
    };
  }, [render]);

  // Re-render on prop changes (world tick, selection, threats, …).
  // Also update the sim-to-real ratio used for smooth sub motion. The
  // ratio is observed from the gap between consecutive world snapshots
  // so it adapts to the actual SIM_SPEED the server is running at.
  useEffect(() => {
    const now = Date.now();
    const prevSimTime = worldTimeAtRecvRef.current;
    const prevRecv = worldRecvAtRef.current;
    worldTimeAtRecvRef.current = props.world.time;
    worldRecvAtRef.current = now;
    if (prevSimTime > 0 && now > prevRecv) {
      const observed = (props.world.time - prevSimTime) / (now - prevRecv);
      // Reject obviously bogus values (e.g. the first sample when prev=0,
      // or huge jumps from a server reset). A reasonable sim runs at
      // 0.1× to 5000× real time.
      if (observed > 0 && observed < 5000) {
        // Light exponential smoothing — favour the new observation but
        // dampen single-tick jitter.
        simRatioRef.current =
          simRatioRef.current === 0 ? observed : simRatioRef.current * 0.4 + observed * 0.6;
      }
    }
    // Refresh the "will this sub lose its combat?" cache. The work is
    // heavy (structuredClone(world) + tick(projection) per sub), so we
    // throttle two ways:
    //   1. Hard rate-limit to WILL_LOSE_REFRESH_MS (1.5 s by default).
    //   2. Fingerprint relevant fields; skip entirely if nothing
    //      combat-relevant changed since the last sample.
    // A re-run is always forced when previously-flagged subs disappear
    // (otherwise the marker could stick around after the sub arrived).
    const fingerprint = makeWillLoseFingerprint(props.world);
    const sinceLast = now - willLoseLastAtRef.current;
    if (
      sinceLast >= WILL_LOSE_REFRESH_MS ||
      fingerprint !== willLoseFingerprintRef.current
    ) {
      willLoseLastAtRef.current = now;
      willLoseFingerprintRef.current = fingerprint;
      const losers = new Set<SubId>();
      const outpostById = new Map<OutpostId, Outpost>();
      for (const o of props.world.outposts) outpostById.set(o.id, o);
      // Pre-filter: only project subs that could actually lose to a
      // hostile defender within the near future. Skips reinforcements,
      // gifts, dormant captures, and arrivals more than 12 sim-hours
      // away — those don't drive immediate decisions and projecting
      // them all is the main GC pressure source.
      const horizon = props.world.time + WILL_LOSE_HORIZON_MS;
      const relevant: Sub[] = [];
      for (const sub of props.world.subs) {
        if (sub.arrivalAt > horizon) continue;
        const dst = outpostById.get(sub.destinationId);
        if (!dst) continue;
        if (dst.ownerId === sub.ownerId) continue; // reinforce — never loses
        if (dst.ownerId === null) continue; // dormant capture — never loses
        if (sub.giftTo !== undefined && sub.giftTo !== null) continue; // gift
        relevant.push(sub);
      }
      if (relevant.length > 0) {
        try {
          // Single shared clone + tick — was N clones before.
          const previews = simulateMultipleSubArrivals(props.world, relevant);
          for (const sub of relevant) {
            const preview = previews.get(sub.id as unknown as number);
            if (
              preview !== undefined &&
              (preview.outcome === 'defender-wins' || preview.outcome === 'tie')
            ) {
              losers.add(sub.id);
            }
          }
        } catch {
          // ignore — transitional state
        }
      }
      willLoseRef.current = losers;
    }
    render();
  }, [
    render,
    props.world,
    props.activePlayerId,
    props.selectedOutpostId,
    props.threats,
  ]);

  // When the active player switches, re-center on the new queen.
  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    const queenHomeId = queenOutpostOf(propsRef.current.world, props.activePlayerId);
    if (queenHomeId === null) return;
    const home = propsRef.current.world.outposts.find((o) => o.id === queenHomeId);
    if (!home) return;
    cameraRef.current = focusCamera(app, home.pos, cameraRef.current.zoom);
    render();
  }, [props.activePlayerId, render]);

  useImperativeHandle(
    ref,
    () => ({
      fitAll: () => {
        const app = appRef.current;
        if (!app) return;
        cameraRef.current = fitAllCamera(app);
        render();
      },
      centerOn: (id) => {
        const app = appRef.current;
        if (!app) return;
        const o = propsRef.current.world.outposts.find((x) => x.id === id);
        if (!o) return;
        cameraRef.current = focusCamera(app, o.pos, cameraRef.current.zoom);
        render();
      },
      centerOnPos: (pos) => {
        const app = appRef.current;
        if (!app) return;
        cameraRef.current = focusCamera(app, pos, cameraRef.current.zoom);
        render();
      },
      fitOutposts: (ids) => {
        const app = appRef.current;
        if (!app) return;
        const wOutposts = propsRef.current.world.outposts;
        const points: { x: number; y: number }[] = [];
        for (const id of ids) {
          const o = wOutposts.find((x) => x.id === id);
          if (o) points.push({ x: o.pos.x, y: o.pos.y });
        }
        if (points.length === 0) return;
        cameraRef.current = fitPointsCamera(app, points);
        render();
      },
      zoomBy: (delta) => {
        const app = appRef.current;
        if (!app) return;
        const { w, h } = viewportSize(app);
        zoomAround(cameraRef.current, w / 2, h / 2, Math.pow(2, delta));
        render();
      },
      pulseAt: (x, y, to, kind = 'info') => {
        const start = Date.now();
        pulsesRef.current.push({ x, y, startMs: start, kind });
        if (to) {
          tracersRef.current.push({
            x1: x,
            y1: y,
            x2: to.x,
            y2: to.y,
            startMs: start,
          });
          pulsesRef.current.push({ x: to.x, y: to.y, startMs: start, kind });
        }
        render();
      },
    }),
    [render],
  );

  return <div ref={hostRef} className="map-host" />;
});

// ============================================================================
// Scene update — diffs nodes against current world
// ============================================================================

interface RenderRefs {
  bathyRef: MutableRefObject<TilingSprite | null>;
  sonarRef: MutableRefObject<Graphics | null>;
  fogRef: MutableRefObject<Graphics | null>;
  fogMaskRef: MutableRefObject<Graphics | null>;
  trailLayerRef: MutableRefObject<Container | null>;
  entityLayerRef: MutableRefObject<Container | null>;
  outpostNodesRef: MutableRefObject<Map<string, OutpostNode>>;
  subNodesRef: MutableRefObject<Map<string, SubNode>>;
  trailGraphicsRef: MutableRefObject<Map<string, Graphics>>;
  outpostHitsRef: MutableRefObject<OutpostHit[]>;
  subHitsRef: MutableRefObject<SubHit[]>;
  /** Drag/press interaction state — the reachable-range dim during
   *  a drag-launch reads from here. */
  interactionRef: MutableRefObject<Interaction>;
  /** Per-pair markers for predicted sub-vs-sub encounters. */
  encounterMarkersRef: MutableRefObject<
    Map<string, { ring: Graphics; text: Text }>
  >;
}

function drawScene(
  app: Application,
  props: PixiMapProps,
  camera: Camera,
  subTime: number,
  willLoseSet: Set<SubId>,
  refs: RenderRefs,
): void {
  const sonar = refs.sonarRef.current;
  const fog = refs.fogRef.current;
  const fogMask = refs.fogMaskRef.current;
  const trailLayer = refs.trailLayerRef.current;
  const entityLayer = refs.entityLayerRef.current;
  if (!sonar || !fog || !fogMask || !trailLayer || !entityLayer) return;

  refreshHitArea(app);

  const { world, activePlayerId, selectedOutpostId, threats } = props;

  // Tile-aware rendering: the map is a flat torus, so the visible window
  // can overlap multiple tile copies of the world (the canonical tile at
  // (0,0) plus neighbours offset by ±MAP_SIZE on either axis). We draw
  // every entity once per visible tile so panning past a seam reveals
  // the world continuing seamlessly, matching the original Subterfuge's
  // "no corners" feel.
  const { w: viewW, h: viewH } = viewportSize(app);
  // Bound the tile-key space by wrapping pan so the visible-tile
  // coordinates stay in a small neighbourhood around (0, 0). The wrap
  // is visually invisible because rendering already tiles the world.
  normalizePan(camera, viewW, viewH);
  const tiles = computeVisibleTiles(camera, viewW, viewH);

  // Bathymetric chart tile tracks the camera. The texture spans one
  // full map tile, so tileScale maps texture pixels → screen pixels and
  // tilePosition is just the camera pan (TilingSprite wraps for free,
  // mirroring the torus). Four scalar writes per frame — nothing else.
  const bathy = refs.bathyRef.current;
  if (bathy) {
    bathy.width = viewW;
    bathy.height = viewH;
    const ts = (camera.zoom * MAP_SIZE) / BATHY_TEX;
    bathy.tileScale.set(ts, ts);
    bathy.tilePosition.set(camera.panX, camera.panY);
  }

  // Active player at their electrical cap → all their factories pause.
  // Computed once per render instead of per-outpost.
  const cap = electricalOutput(world, activePlayerId);
  const stock = totalDrillers(world, activePlayerId);
  const activePlayerAtCap = cap > 0 && stock >= cap;

  // Per-render outpost lookup map. Replaces the O(N) `world.outposts.find`
  // call inside the sub loops, which previously ran (subs × tiles × 2)
  // linear scans every frame.
  const outpostById = new Map<OutpostId, Outpost>();
  for (const o of world.outposts) outpostById.set(o.id, o);

  // Specialist glyph rows per entity. Computed once per frame so the
  // O(specialists) walk is not paid per outpost / per tile.
  // ACTIVE specialists render in the chip ABOVE the outpost (the
  // player's roster at that location). CAPTIVES render in a separate
  // chip BELOW the name, dim and tinted by their ORIGINAL OWNER so
  // the player can see at a glance "whose specialists am I holding."
  // No "+N" truncation — the chip renderer wraps long lists to
  // multiple rows (see layoutChipRow / layoutCaptiveRow).
  // Per-entity list of glyphs (one entry per chip — discrete chips
  // are rendered downstream, NOT a joined string). Empty list = no
  // chip row.
  const specsByOutpost = new Map<number, string[]>();
  const specsBySub = new Map<number, string[]>();
  // Captives are grouped per original-owner so each owner gets its
  // own coloured chip beneath the outpost: e.g. `[♛,◉]` in player B's
  // colour + `[†]` in player C's colour.
  const captivesByOutpost = new Map<number, Map<number, string[]>>();
  const tmpOut = new Map<number, string[]>();
  const tmpSub = new Map<number, string[]>();
  for (const s of world.specialists) {
    const info = SPECIALISTS[s.kind];
    if (info === undefined) continue;
    if (s.state === 'captive') {
      if (s.location.kind !== 'outpost') continue;
      const oid = s.location.id as unknown as number;
      let perOwner = captivesByOutpost.get(oid);
      if (perOwner === undefined) {
        perOwner = new Map<number, string[]>();
        captivesByOutpost.set(oid, perOwner);
      }
      const owner = s.ownerId as unknown as number;
      const list = perOwner.get(owner) ?? [];
      list.push(info.glyph);
      perOwner.set(owner, list);
      continue;
    }
    if (s.state !== 'active') continue;
    if (s.location.kind === 'outpost') {
      const id = s.location.id as unknown as number;
      const arr = tmpOut.get(id) ?? [];
      arr.push(info.glyph);
      tmpOut.set(id, arr);
    } else {
      const id = s.location.id as unknown as number;
      const arr = tmpSub.get(id) ?? [];
      arr.push(info.glyph);
      tmpSub.set(id, arr);
    }
  }
  // Full lists pass through — no truncation. layoutChipRow handles
  // wrapping to multiple rows when the glyph count exceeds
  // CHIP_ROW_MAX, keeping every specialist visible.
  for (const [id, arr] of tmpOut) specsByOutpost.set(id, arr);
  for (const [id, arr] of tmpSub) specsBySub.set(id, arr);
  // Flatten captives map → `[{ ownerId, glyphs }]` sorted by ownerId for
  // a stable left-to-right order across frames.
  const captivesFlatByOutpost = new Map<
    number,
    { ownerId: number; glyphs: string[] }[]
  >();
  for (const [oid, perOwner] of captivesByOutpost) {
    const groups: { ownerId: number; glyphs: string[] }[] = [];
    const owners = [...perOwner.keys()].sort((a, b) => a - b);
    for (const owner of owners) {
      groups.push({ ownerId: owner, glyphs: perOwner.get(owner)! });
    }
    captivesFlatByOutpost.set(oid, groups);
  }
  const EMPTY_CAPTIVE_GROUPS: ReadonlyArray<{ ownerId: number; glyphs: string[] }> = [];

  // Camera fingerprint for cheap trail-redraw skip. The trail's screen
  // geometry only depends on (camera, src.pos, vdst.pos, ownerId) — none
  // of which change between server snapshots or within a frame. So if
  // this key matches the trail's cached one we can skip the dashed-line
  // path build entirely.
  const cameraKey = `${camera.zoom.toFixed(5)}|${camera.panX.toFixed(2)}|${camera.panY.toFixed(2)}`;

  // ----- Outpost nodes (diff against world.outposts × visible tiles) -----
  // Hide all existing tile copies up-front; the visible ones get re-shown
  // below. We intentionally never call `node.destroy()` here: Pixi v8's
  // CanvasText texture pool throws when many Text children are torn
  // down in rapid succession (returnTexture pushes to an undefined slot).
  // Keeping the nodes alive is also a performance win when the user
  // pans back across a recently-visible tile.
  for (const node of refs.outpostNodesRef.current.values()) {
    node.setVisible(false);
  }
  refs.outpostHitsRef.current.length = 0;

  // Reachable-range dim during a drag-launch. The drag is internal
  // to PixiMap so we read the interaction ref directly.
  const dragInter = refs.interactionRef.current;
  const dragSourceId: OutpostId | null =
    dragInter.kind === 'drag-launch' ? dragInter.sourceId : null;
  const dimSource: Outpost | undefined =
    dragSourceId !== null ? outpostById.get(dragSourceId) : undefined;
  // Threshold: "near" is anything reachable in 12 base-speed hours
  // (~1,200 units on a 10,000-wide torus).
  const NEAR_HOURS = 12;
  const NEAR_UNITS = (NEAR_HOURS * HOUR_MS) / 36_000;

  for (const o of world.outposts) {
    const isSelected = selectedOutpostId === o.id;
    const isLaunchSource = dragSourceId === o.id;
    // No picker mode → no picker-target highlighting. Drag overlay
    // handles target affordances directly.
    const isPickerTarget = false;
    let outpostDim = 1;
    if (dimSource !== undefined && !isLaunchSource) {
      const d = dist(dimSource.pos, o.pos);
      if (d > NEAR_UNITS) outpostDim = 0.4;
    }
    // Outposts OUTSIDE the active player's sonar (fogged) are dimmed
    // so the player visually understands "I don't have eyes on this
    // one." Applies regardless of ownership — your own outpost
    // doesn't typically fog (your sonar covers it), but an enemy
    // outpost you've only briefly seen drops to fogged once your
    // sonar moves away.
    if (o.fogged === true) {
      outpostDim = Math.min(outpostDim, 0.5);
    }
    const threat = threats.get(o.id);
    const ownThreat =
      threat !== undefined && o.ownerId === activePlayerId && o.fogged !== true
        ? threat
        : null;
    for (const { tx, ty } of tiles) {
      const key = `${o.id}|${tx}|${ty}`;
      let node = refs.outpostNodesRef.current.get(key);
      if (!node) {
        node = new OutpostNode();
        refs.outpostNodesRef.current.set(key, node);
        entityLayer.addChild(node.container);
      }
      node.setVisible(true);
      const isPausedFactory =
        o.kind === 'factory' &&
        o.ownerId === activePlayerId &&
        o.fogged !== true &&
        activePlayerAtCap;
      const isFogged = o.fogged === true;
      const liveShield = isFogged ? 0 : currentShieldCharge(o, world.time, world);
      const liveShieldMax = isFogged ? 10 : maxShieldCharge(world, o);
      node.update(
        o,
        isSelected,
        isLaunchSource,
        ownThreat,
        isPausedFactory,
        camera.zoom,
        world.time,
        hasQueenAt(world, o.id),
        liveShield,
        liveShieldMax,
        isPickerTarget,
        specsByOutpost.get(o.id as unknown as number) ?? EMPTY_SPECS,
        outpostDim,
        captivesFlatByOutpost.get(o.id as unknown as number) ?? EMPTY_CAPTIVE_GROUPS,
      );
      const { sx, sy } = worldToScreen(
        camera,
        o.pos.x + tx * MAP_SIZE,
        o.pos.y + ty * MAP_SIZE,
      );
      node.setScreen(sx, sy);
      refs.outpostHitsRef.current.push({ id: o.id, tx, ty, sx, sy, r: OUTPOST_HIT_R });
    }
  }

  // ----- Sub nodes + trails (in-flight subs × visible tiles) -----
  // Same hide-don't-destroy strategy as outposts above — Pixi v8's text
  // pool can't tolerate rapid destruction.
  for (const node of refs.subNodesRef.current.values()) {
    node.setVisible(false);
  }
  for (const g of refs.trailGraphicsRef.current.values()) {
    g.visible = false;
  }
  refs.subHitsRef.current.length = 0;
  // Trails are now per-sub (each line starts at its own live position),
  // so there's nothing to dedup across subs. This set just guards
  // against drawing the same sub×tile twice in one frame.
  const drawnRouteKeys = new Set<string>();
  for (const sub of world.subs) {
    if (subStatus(sub, world.time) !== 'in_flight') continue;
    const src = outpostById.get(sub.sourceId);
    const dst = outpostById.get(sub.destinationId);
    if (!src || !dst) continue;

    const inChase = sub.chase !== undefined;
    const isReturning = inChase && sub.chase!.phase === 'returning';
    const isChasing = inChase && sub.chase!.phase === 'chasing';
    // EVERY sub's trail is anchored at the sub's CURRENT position and
    // drawn forward to WHERE THE SUB IS ACTUALLY GOING — never behind it,
    // and never to a point the sub isn't heading for. The line therefore
    // always matches the blip's motion:
    //   - regular sub  : live pos → destination outpost
    //   - pirate chase : live pos → intercept point (where it will meet
    //                    the target — NOT the target's current spot; the
    //                    sub leads the target, so drawing the line to the
    //                    live target made the sub look like it was flying
    //                    off course)
    //   - return leg   : live pos → home outpost
    const subLivePos = subPosition(world, sub, subTime);
    const trailFrom = subLivePos;
    const trailToRaw = inChase ? sub.chase!.interceptPos : dst.pos;
    // Extend the endpoint off-plane relative to the sub so the line
    // follows the SHORT toroidal route across the map seam.
    const trailTo = virtualDestination(trailFrom, trailToRaw);
    // Trail color encodes INTENT, not just owner identity:
    //   - normal attack/reinforce: owner color (familiar)
    //   - gift sub: RECIPIENT color (so an inbound gift to you reads
    //     instantly as "yours-flavoured" — a friendly arrival)
    // The HULL itself still uses the owner color so the sender is
    // also visible.
    const isGift = sub.giftTo !== undefined;
    const trailColor = isGift ? playerColor(sub.giftTo!) : playerColor(sub.ownerId);
    const color = playerColor(sub.ownerId); // hull color
    // Hull heading = the line direction (sub → where it's going). The
    // trail end now equals the sub's true destination for every phase,
    // so the generic live-pos→trailTo angle is correct in all cases.
    const angle = Math.atan2(
      torusDelta(trailFrom.y, trailTo.y),
      torusDelta(trailFrom.x, trailTo.x),
    );
    const willLose = willLoseSet.has(sub.id);
    // The blip sits at the sim's authoritative live position; the trail
    // is anchored there too, so blip and line always agree.
    const wxBase = subLivePos.x;
    const wyBase = subLivePos.y;
    // The trail's start (the sub) moves every frame; fold the live sub
    // position into the cache key so the cached line is redrawn as the
    // sub moves (otherwise it freezes at its first-drawn endpoints).
    const motionQuantum = `|${Math.round(subLivePos.x)},${Math.round(subLivePos.y)}`;
    const trailBaseKey = `${cameraKey}|${sub.ownerId}|${sub.giftTo ?? 'x'}|${src.id}|${dst.id}|${
      inChase ? sub.chase!.phase : 'go'
    }${motionQuantum}`;

    for (const { tx, ty } of tiles) {
      const offX = tx * MAP_SIZE;
      const offY = ty * MAP_SIZE;
      // Per-sub trail + blip keys. Every sub's line now starts at its
      // OWN live position, so subs sharing a route can no longer share
      // a single line — each gets its own per-sub trail.
      const trailKeyId = `s|${sub.id}|${tx}|${ty}`;
      const subNodeKey = `s|${sub.id}|${tx}|${ty}`;
      const skipTrailDraw = drawnRouteKeys.has(trailKeyId);
      if (!skipTrailDraw) {
        drawnRouteKeys.add(trailKeyId);

        // Trail style:
        //   - normal in-flight  → solid thin line, owner color
        //   - pirate chasing    → dashed line (the chase is hypothetical)
        //   - pirate returning  → solid, double-weight (committed return)
        let trail = refs.trailGraphicsRef.current.get(trailKeyId) as
          | (Graphics & { _trailKey?: string })
          | undefined;
        if (!trail) {
          trail = new Graphics() as Graphics & { _trailKey?: string };
          refs.trailGraphicsRef.current.set(trailKeyId, trail);
          trailLayer.addChild(trail);
        }
        trail.visible = true;
        const fullTrailKey = `${trailBaseKey}|${tx}|${ty}`;
        if (trail._trailKey !== fullTrailKey) {
          trail._trailKey = fullTrailKey;
          const a = worldToScreen(camera, trailFrom.x + offX, trailFrom.y + offY);
          const b = worldToScreen(camera, trailTo.x + offX, trailTo.y + offY);
          trail.clear();
          if (isChasing) {
            drawDashedSegment(trail, a.sx, a.sy, b.sx, b.sy, color);
            trail.stroke({ width: 1, color, alpha: 0.55 });
          } else if (isReturning) {
            trail
              .moveTo(a.sx, a.sy)
              .lineTo(b.sx, b.sy)
              .stroke({ width: 1.8, color, alpha: 0.7 });
          } else if (isGift) {
            // Gift sub: dashed trail in the recipient's color. The
            // pattern visually distinguishes "friendly inbound" from a
            // hostile attack at the same colour palette.
            drawDashedSegment(trail, a.sx, a.sy, b.sx, b.sy, trailColor);
            trail.stroke({ width: 1.2, color: trailColor, alpha: 0.55 });
          } else {
            // Projected course: a fine dim line to the destination. The
            // wake (below) is the bright element — course stays quiet so
            // the map reads "where it IS" louder than "where it's going".
            trail
              .moveTo(a.sx, a.sy)
              .lineTo(b.sx, b.sy)
              .stroke({ width: 1, color: trailColor, alpha: 0.28 });
            // Course ticks every ~64px — sonar-chart range marks that
            // also give the line a subtle sense of motion direction.
            const cdx = b.sx - a.sx;
            const cdy = b.sy - a.sy;
            const clen = Math.sqrt(cdx * cdx + cdy * cdy);
            if (clen > 80) {
              const ux = cdx / clen;
              const uy = cdy / clen;
              const px = -uy;
              const py = ux;
              for (let d = 64; d < clen - 24; d += 64) {
                const cx = a.sx + ux * d;
                const cy = a.sy + uy * d;
                trail
                  .moveTo(cx - px * 2.5, cy - py * 2.5)
                  .lineTo(cx + px * 2.5, cy + py * 2.5)
                  .stroke({ width: 1, color: trailColor, alpha: 0.35 });
              }
            }
          }
          // Wake — a bright streak fading out behind the blip, in the
          // OWNER colour for every moving sub (gift trails recolour the
          // course, but the wake belongs to whoever is driving). This is
          // what makes motion direction pre-attentive at a glance.
          {
            const wdx = a.sx - b.sx;
            const wdy = a.sy - b.sy;
            const wlen = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
            const wux = wdx / wlen;
            const wuy = wdy / wlen;
            const wake: Array<[number, number, number, number]> = [
              [4, 16, 2.6, 0.5],
              [16, 32, 1.7, 0.26],
              [32, 50, 1.0, 0.11],
            ];
            for (const [d0, d1, wdt, al] of wake) {
              trail
                .moveTo(a.sx + wux * d0, a.sy + wuy * d0)
                .lineTo(a.sx + wux * d1, a.sy + wuy * d1)
                .stroke({ width: wdt, color, alpha: al });
            }
          }
        }
      }

      // Sub blip — ALWAYS per-sub. Even when multiple subs share a
      // trail line, each gets its own blip so the user can count
      // them.
      const screen = worldToScreen(camera, wxBase + offX, wyBase + offY);
      let node = refs.subNodesRef.current.get(subNodeKey);
      if (!node) {
        node = new SubNode();
        refs.subNodesRef.current.set(subNodeKey, node);
        entityLayer.addChild(node.container);
      }
      node.setVisible(true);
      // Reinforce iff the sub's owner equals destination owner AND it's
      // not a gift (gifts go to a different recipient). dst is the
      // outpost; sub.ownerId === dst.ownerId is enough — gifts are
      // identified by sub.giftTo being set, in which case ownerId !=
      // recipient and the trail already encodes recipient color.
      const isReinforce =
        !isGift && dst.ownerId !== null && dst.ownerId === sub.ownerId;
      node.update(
        sub,
        angle,
        camera.zoom,
        false,
        willLose,
        specsBySub.get(sub.id as unknown as number) ?? EMPTY_SPECS,
        isReinforce,
      );
      node.setScreen(screen.sx, screen.sy);
      refs.subHitsRef.current.push({
        id: sub.id,
        tx,
        ty,
        sx: screen.sx,
        sy: screen.sy,
        r: 16,
      });
    }
  }

  // ----- Predicted sub-vs-sub encounter markers (G10) -----
  // For every pair of subs on mirror-route trajectories, draw a small
  // phosphor ring + countdown label at the meeting point so the
  // player can scan the map for upcoming collisions without tapping
  // each sub. Only encounters within ENCOUNTER_HORIZON_MS sim-time of
  // now are shown (further-out encounters are too speculative —
  // either sub could be redirected by then).
  const ENCOUNTER_HORIZON_MS = 12 * HOUR_MS;
  // Hide every marker first — surviving ones get re-shown below.
  for (const m of refs.encounterMarkersRef.current.values()) {
    m.ring.visible = false;
    m.text.visible = false;
  }
  const activeEncounters = new Set<string>();
  for (let i = 0; i < world.subs.length; i++) {
    const a = world.subs[i]!;
    if (subStatus(a, world.time) !== 'in_flight') continue;
    if (a.chase !== undefined) continue; // chases handled separately
    for (let j = i + 1; j < world.subs.length; j++) {
      const b = world.subs[j]!;
      if (subStatus(b, world.time) !== 'in_flight') continue;
      if (b.chase !== undefined) continue;
      const meet = mirrorEncounterTime(a, b);
      if (meet === null) continue;
      if (meet - world.time > ENCOUNTER_HORIZON_MS) continue;
      if (meet <= world.time) continue;
      const aIdN = a.id as unknown as number;
      const bIdN = b.id as unknown as number;
      const key = aIdN < bIdN ? `${aIdN}|${bIdN}` : `${bIdN}|${aIdN}`;
      activeEncounters.add(key);
      // Meeting point — both subs are at the same coord at meet time.
      const meetPos = subPosition(world, a, meet);
      // Marker color: warn-orange = combat is incoming, distinct from
      // outpost rings (phosphor) and threat halos (already orange on
      // outposts, but those are halos on the outpost body, not free-
      // standing rings on the open map).
      const screen = worldToScreen(camera, meetPos.x, meetPos.y);
      let marker = refs.encounterMarkersRef.current.get(key);
      if (marker === undefined) {
        const ring = new Graphics();
        const text = new Text({
          text: '',
          style: {
            fontFamily: 'var(--mono-display)',
            fontSize: 9,
            fill: 0xffb547,
            letterSpacing: 1,
          } as TextStyleOptions,
        });
        text.anchor.set(0.5, 0.5);
        entityLayer.addChild(ring, text);
        marker = { ring, text };
        refs.encounterMarkersRef.current.set(key, marker);
      }
      marker.ring.clear();
      marker.ring.circle(screen.sx, screen.sy, 7);
      marker.ring.stroke({ width: 1, color: 0xffb547, alpha: 0.85 });
      marker.ring.visible = true;
      const dt = meet - world.time;
      const mins = Math.max(1, Math.round(dt / MINUTE_MS));
      const label = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}m` : `${mins}m`;
      if (marker.text.text !== label) marker.text.text = label;
      marker.text.position.set(screen.sx, screen.sy - 14);
      marker.text.visible = true;
    }
  }
  // Pirate-chase intercepts get the same treatment: a ring + countdown
  // at the point where the pirate will catch its quarry. Same marker
  // pool; keyed `c|<pirateSubId>`. Red — an intercept IS the combat
  // (the pair loop above skips chases, so without this the pirate's
  // meet point had no marker at all).
  for (const sub of world.subs) {
    if (subStatus(sub, world.time) !== 'in_flight') continue;
    if (sub.chase === undefined || sub.chase.phase !== 'chasing') continue;
    if (sub.arrivalAt <= world.time) continue;
    if (sub.arrivalAt - world.time > ENCOUNTER_HORIZON_MS) continue;
    const key = `c|${sub.id as unknown as number}`;
    activeEncounters.add(key);
    const screen = worldToScreen(
      camera,
      sub.chase.interceptPos.x,
      sub.chase.interceptPos.y,
    );
    let marker = refs.encounterMarkersRef.current.get(key);
    if (marker === undefined) {
      const ring = new Graphics();
      const text = new Text({
        text: '',
        style: {
          fontFamily: 'var(--mono-display)',
          fontSize: 9,
          fill: 0xff5470,
          letterSpacing: 1,
        } as TextStyleOptions,
      });
      text.anchor.set(0.5, 0.5);
      entityLayer.addChild(ring, text);
      marker = { ring, text };
      refs.encounterMarkersRef.current.set(key, marker);
    }
    marker.ring.clear();
    marker.ring.circle(screen.sx, screen.sy, 7);
    marker.ring.stroke({ width: 1, color: 0xff5470, alpha: 0.85 });
    // Cross-hair ticks — distinguishes "intercept" from the neutral
    // orange meet ring at a glance.
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      marker.ring
        .moveTo(screen.sx + dx * 9, screen.sy + dy * 9)
        .lineTo(screen.sx + dx * 13, screen.sy + dy * 13)
        .stroke({ width: 1, color: 0xff5470, alpha: 0.85 });
    }
    marker.ring.visible = true;
    const dt = sub.arrivalAt - world.time;
    const mins = Math.max(1, Math.round(dt / MINUTE_MS));
    const label = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}m` : `${mins}m`;
    if (marker.text.text !== label) marker.text.text = label;
    marker.text.position.set(screen.sx, screen.sy - 18);
    marker.text.visible = true;
  }

  // Reap markers whose encounter is no longer active (subs arrived,
  // redirected, or destroyed). Mark them invisible and drop the entry
  // — Pixi keeps the underlying Graphics alive until destroy().
  for (const [key, m] of refs.encounterMarkersRef.current.entries()) {
    if (!activeEncounters.has(key)) {
      m.ring.visible = false;
      m.text.visible = false;
      refs.encounterMarkersRef.current.delete(key);
      m.ring.destroy();
      m.text.destroy();
    }
  }

  // ----- Queued subs — the 10-min pre-launch window. Render at the
  // source outpost. The queued sub renders EXACTLY at the source
  // (no offset), so "pending" reads as "still docked at this
  // outpost" rather than "flying nearby." The node's `queued=true`
  // flag drives the visual treatment (dashed pulse outline) — see
  // SubNode.update.
  for (const sub of world.subs) {
    if (subStatus(sub, world.time) !== 'queued') continue;
    const src = outpostById.get(sub.sourceId);
    const dst = outpostById.get(sub.destinationId);
    if (!src || !dst) continue;
    const vdst = virtualDestination(src.pos, dst.pos);
    const angle = Math.atan2(vdst.y - src.pos.y, vdst.x - src.pos.x);
    for (const { tx, ty } of tiles) {
      // NB: same `<prefix>|<subId>|…` shape as in-flight keys — the
      // dead-node sweep below parses segment [1] as the sub id.
      const key = `q|${sub.id}|${tx}|${ty}`;
      // Planned course — faint dashed line to the destination so a
      // pending order reads as "this outpost is about to send a sub
      // THERE", not just a halo on the source. Static during the
      // fuse, so it only redraws on camera change.
      const planKey = `q|${sub.id}|plan|${tx}|${ty}`;
      let plan = refs.trailGraphicsRef.current.get(planKey) as
        | (Graphics & { _trailKey?: string })
        | undefined;
      if (!plan) {
        plan = new Graphics() as Graphics & { _trailKey?: string };
        refs.trailGraphicsRef.current.set(planKey, plan);
        trailLayer.addChild(plan);
      }
      plan.visible = true;
      const planFullKey = `${cameraKey}|${src.id}|${dst.id}|${tx}|${ty}`;
      if (plan._trailKey !== planFullKey) {
        plan._trailKey = planFullKey;
        const offX = tx * MAP_SIZE;
        const offY = ty * MAP_SIZE;
        const a = worldToScreen(camera, src.pos.x + offX, src.pos.y + offY);
        const b = worldToScreen(camera, vdst.x + offX, vdst.y + offY);
        plan.clear();
        drawDashedSegment(plan, a.sx, a.sy, b.sx, b.sy, playerColor(sub.ownerId));
        plan.stroke({ width: 1, color: playerColor(sub.ownerId), alpha: 0.35 });
      }
      let node = refs.subNodesRef.current.get(key);
      if (!node) {
        node = new SubNode();
        refs.subNodesRef.current.set(key, node);
        entityLayer.addChild(node.container);
      }
      node.setVisible(true);
      node.update(
        sub,
        angle,
        camera.zoom,
        true,
        willLoseSet.has(sub.id),
        specsBySub.get(sub.id as unknown as number) ?? EMPTY_SPECS,
        dst.ownerId === sub.ownerId && sub.giftTo === undefined,
        sub.launchAt - world.time,
      );
      const screen = worldToScreen(
        camera,
        src.pos.x + tx * MAP_SIZE,
        src.pos.y + ty * MAP_SIZE,
      );
      node.setScreen(screen.sx, screen.sy);
      refs.subHitsRef.current.push({
        id: sub.id,
        tx,
        ty,
        sx: screen.sx,
        sy: screen.sy,
        r: 14,
      });
    }
  }

  // ----- Dead-sub node sweep (amortized). Outposts are permanent, but
  // subs arrive/are cancelled and vanish from world.subs — their hidden
  // SubNodes and trail Graphics would otherwise accumulate for the whole
  // match. Destroy a few per frame: a small cap keeps us clear of the
  // Pixi v8 text-pool crash that mass teardown provokes (see the
  // hide-don't-destroy comment above), while still draining every dead
  // node within a second of its sub disappearing.
  {
    const liveSubIds = new Set<number>();
    for (const s of world.subs) liveSubIds.add(s.id as unknown as number);
    let budget = 8;
    for (const [key, node] of refs.subNodesRef.current) {
      if (budget === 0) break;
      const id = Number(key.split('|')[1]);
      if (!liveSubIds.has(id)) {
        refs.subNodesRef.current.delete(key);
        node.destroy();
        budget -= 1;
      }
    }
    for (const [key, g] of refs.trailGraphicsRef.current) {
      if (budget === 0) break;
      const id = Number(key.split('|')[1]);
      if (!liveSubIds.has(id)) {
        refs.trailGraphicsRef.current.delete(key);
        g.destroy();
        budget -= 1;
      }
    }
  }

  // ----- Fog of war — ALWAYS on. Dim everything OUTSIDE the player's
  // sonar union so the lit area reads as "what you can see" at a glance,
  // no tapping required.
  //
  // `fogMask` collects one circle per owned, currently-visible outpost
  // (effective radius via sonarRange → accounts for Princess +50% local
  // and Intelligence Officer +25% each). Filling them in ONE pass merges
  // overlaps into a single region — so there are no internal arcs, just
  // one joined vision shape with a single crisp border. `fog` is a
  // screen-filling dim wash shown only OUTSIDE that union via the inverse
  // mask wired in setup; the hard mask edge is the border. It sits at the
  // back, so only the map backdrop dims — entities/labels stay readable.
  fogMask.clear();
  let anyCoverage = false;
  for (const o of world.outposts) {
    if (o.ownerId !== activePlayerId) continue;
    if (o.fogged === true) continue;
    const r = sonarRange(world, o) * camera.zoom;
    for (const { tx, ty } of tiles) {
      const { sx, sy } = worldToScreen(
        camera,
        o.pos.x + tx * MAP_SIZE,
        o.pos.y + ty * MAP_SIZE,
      );
      fogMask.circle(sx, sy, r);
      anyCoverage = true;
    }
  }
  // Single fill → union (alpha mask only reads coverage, colour is moot).
  fogMask.fill({ color: 0xffffff, alpha: 1 });
  fog.clear();
  if (anyCoverage) {
    const { w: vpW, h: vpH } = viewportSize(app);
    fog.rect(0, 0, vpW, vpH).fill({ color: 0x04070e, alpha: 0.6 });
    // Sonar edge treatment — drawn into the SAME inverse-masked
    // graphics, so only the parts OUTSIDE the vision union survive:
    //   - a wide soft phosphor band (the "energy" of the sonar rim)
    //   - a crisp boundary line: each circle is stroked individually,
    //     but every interior arc (circle-overlap region) lies INSIDE
    //     the union and is masked away — only the true union boundary
    //     renders. No manual union-outline math needed.
    for (const o of world.outposts) {
      if (o.ownerId !== activePlayerId) continue;
      if (o.fogged === true) continue;
      const r = sonarRange(world, o) * camera.zoom;
      for (const { tx, ty } of tiles) {
        const { sx, sy } = worldToScreen(
          camera,
          o.pos.x + tx * MAP_SIZE,
          o.pos.y + ty * MAP_SIZE,
        );
        fog.circle(sx, sy, r + 14);
      }
    }
    fog.fill({ color: PHOS, alpha: 0.045 });
    for (const o of world.outposts) {
      if (o.ownerId !== activePlayerId) continue;
      if (o.fogged === true) continue;
      const r = sonarRange(world, o) * camera.zoom;
      for (const { tx, ty } of tiles) {
        const { sx, sy } = worldToScreen(
          camera,
          o.pos.x + tx * MAP_SIZE,
          o.pos.y + ty * MAP_SIZE,
        );
        fog
          .circle(sx, sy, r)
          .stroke({ width: 2.5, color: PHOS, alpha: 0.3 });
      }
    }
  }

  // Selected-outpost ring — one highlight circle so the open sheet's
  // target is locatable on the map (a single ring, not the whole union,
  // so it doesn't reintroduce overlapping-circle clutter).
  sonar.clear();
  const selected =
    selectedOutpostId === null
      ? null
      : world.outposts.find(
          (x) =>
            (x.id as unknown as number) ===
            (selectedOutpostId as unknown as number),
        ) ?? null;
  if (selected && selected.ownerId === activePlayerId && selected.fogged !== true) {
    const r = sonarRange(world, selected) * camera.zoom;
    for (const { tx, ty } of tiles) {
      const { sx, sy } = worldToScreen(
        camera,
        selected.pos.x + tx * MAP_SIZE,
        selected.pos.y + ty * MAP_SIZE,
      );
      sonar.circle(sx, sy, r).stroke({ width: 1, color: PHOS, alpha: 0.5 });
    }
  }

  // Sentry attrition ranges — ALWAYS visible (not gated on selection)
  // for EVERY sentry the player can see, theirs or hostile. This leaks
  // nothing: the server's viewForPlayer only ships specialists whose
  // outpost is inside the viewer's sonar, so any sentry present in
  // this (already filtered) world is known to the player — the outpost
  // sheet even lists it. An enemy sentry zone is precisely what your
  // subs must route around, so it gets the stronger threat treatment;
  // your own zones stay a quiet light red.
  //
  // Radius matches the server's fireSentry: half the outpost's
  // EFFECTIVE sonar (Princess/IO modifiers included) — computed from
  // visible info, so it's best-effort for rivals with hidden IOs.
  const sentryRedOwn = 0xff8e9e; // lighter red — well below --crit intensity
  const drawnSentryOutposts = new Set<number>();
  for (const s of world.specialists) {
    if (s.kind !== 'sentry') continue;
    if (s.state !== 'active') continue;
    if (s.location.kind !== 'outpost') continue;
    const op = world.outposts.find((o) => o.id === s.location.id);
    if (op === undefined || op.fogged === true) continue;
    // The sentry only fires while garrisoned at its owner's outpost.
    if (op.ownerId !== s.ownerId) continue;
    // One ring per outpost — stacked sentries share a single zone.
    const opKey = op.id as unknown as number;
    if (drawnSentryOutposts.has(opKey)) continue;
    drawnSentryOutposts.add(opKey);
    const hostile = s.ownerId !== activePlayerId;
    const ringColor = hostile ? THREAT_RED : sentryRedOwn;
    const r = sonarRange(world, op) * 0.5 * camera.zoom;
    for (const { tx, ty } of tiles) {
      const { sx, sy } = worldToScreen(
        camera,
        op.pos.x + tx * MAP_SIZE,
        op.pos.y + ty * MAP_SIZE,
      );
      sonar
        .circle(sx, sy, r)
        .fill({ color: ringColor, alpha: hostile ? 0.05 : 0.04 })
        .stroke({ width: 1, color: ringColor, alpha: hostile ? 0.5 : 0.35 });
    }
  }
}

function drawDashedSegment(
  g: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  // color is reserved for future per-segment styling; the caller currently
  // applies a single stroke after all segments are emitted.
  _color: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const total = Math.sqrt(dx * dx + dy * dy);
  if (total === 0) return;
  const ux = dx / total;
  const uy = dy / total;
  const dash = 5;
  const gap = 5;
  let t = 0;
  while (t < total) {
    const a = Math.min(t + dash, total);
    g.moveTo(x1 + ux * t, y1 + uy * t).lineTo(x1 + ux * a, y1 + uy * a);
    t = a + gap;
  }
}

function refreshHitArea(app: Application): void {
  const { w, h } = viewportSize(app);
  // Reuse the existing Rectangle when present — mutating its width/height
  // is much cheaper than allocating a new one each render. (Per-render
  // garbage was ~one Rectangle/frame.)
  const existing = app.stage.hitArea;
  if (existing instanceof Rectangle) {
    if (existing.width !== w || existing.height !== h) {
      existing.width = w;
      existing.height = h;
    }
    return;
  }
  app.stage.hitArea = new Rectangle(0, 0, w, h);
}

// ============================================================================
// Drag rubber-band overlay (screen space)
// ============================================================================

/**
 * Animated event pulses. Each pulse is an expanding phosphor ring at a
 * world-space coordinate, fading over PULSE_DURATION_MS. Drives attention
 * to recent combat / sentry shots / promotions without spamming toasts.
 *
 * Tracers are short-lived line segments (sentry shot from outpost to
 * target sub) — drawn solid for the first TRACER_HOLD_MS, then fading.
 */
const PULSE_DURATION_MS = 1100;
const PULSE_MAX_R = 36;
const TRACER_DURATION_MS = 700;
const TRACER_HOLD_MS = 200;

function drawPulses(
  layer: Graphics | null,
  pulses: { x: number; y: number; startMs: number; kind: PulseKind }[],
  tracers: { x1: number; y1: number; x2: number; y2: number; startMs: number }[],
  camera: Camera,
): void {
  if (!layer) return;
  layer.clear();
  const now = Date.now();
  // Cull expired in place.
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    if (p && now - p.startMs >= PULSE_DURATION_MS) pulses.splice(i, 1);
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    if (t && now - t.startMs >= TRACER_DURATION_MS) tracers.splice(i, 1);
  }
  if (pulses.length === 0 && tracers.length === 0) return;
  for (const tr of tracers) {
    const age = now - tr.startMs;
    let alpha: number;
    if (age < TRACER_HOLD_MS) alpha = 1;
    else
      alpha = Math.max(
        0,
        1 - (age - TRACER_HOLD_MS) / (TRACER_DURATION_MS - TRACER_HOLD_MS),
      );
    const a = worldToScreen(camera, tr.x1, tr.y1);
    const b = worldToScreen(camera, tr.x2, tr.y2);
    layer
      .moveTo(a.sx, a.sy)
      .lineTo(b.sx, b.sy)
      .stroke({ width: 2, color: PHOS, alpha });
  }
  for (const p of pulses) {
    const t = (now - p.startMs) / PULSE_DURATION_MS;
    if (t < 0 || t > 1) continue;
    const { sx, sy } = worldToScreen(camera, p.x, p.y);
    // Per-kind styling:
    //   info  → phos green, default radius — neutral information
    //   combat→ warn orange, default radius + inner ping — engagement
    //   martyr→ crit red, 1.6× radius, double ring — death blast that
    //           rewards looking; reads as much louder than combat
    let color: number;
    let radiusScale: number;
    let width: number;
    switch (p.kind) {
      case 'combat':
        color = 0xffb547; // --warn
        radiusScale = 1;
        width = 2.5;
        break;
      case 'martyr':
        color = 0xff5470; // --crit
        radiusScale = 1.6;
        width = 3;
        break;
      default:
        color = PHOS;
        radiusScale = 1;
        width = 2;
    }
    const r = PULSE_MAX_R * radiusScale * t;
    const alpha = 1 - t;
    layer.circle(sx, sy, r).stroke({ width, color, alpha });
    // Martyr gets a second inner ring at half radius for the "shock-
    // wave" feel; combat gets a tiny solid centre pip that fades fast.
    if (p.kind === 'martyr') {
      layer
        .circle(sx, sy, r * 0.5)
        .stroke({ width: 1.5, color, alpha: alpha * 0.7 });
    } else if (p.kind === 'combat' && t < 0.4) {
      layer
        .circle(sx, sy, 3)
        .fill({ color, alpha: alpha * 0.9 });
    }
  }
}

function drawDragOverlay(
  overlay: Graphics,
  inter: Extract<Interaction, { kind: 'drag-launch' }>,
  world: World,
  camera: Camera,
  outpostHits: OutpostHit[],
  subHits: SubHit[],
): void {
  overlay.clear();
  const src = world.outposts.find((o) => o.id === inter.sourceId);
  if (!src) return;
  // Anchor the rubber-band at the visible tile copy the user grabbed,
  // not the canonical (0, 0) tile (which may be off-screen).
  const start = worldToScreen(
    camera,
    src.pos.x + inter.sourceTx * MAP_SIZE,
    src.pos.y + inter.sourceTy * MAP_SIZE,
  );
  overlay
    .moveTo(start.sx, start.sy)
    .lineTo(inter.currentSx, inter.currentSy)
    .stroke({ width: 2, color: PHOS, alpha: 0.85 });
  overlay
    .circle(inter.currentSx, inter.currentSy, 7)
    .stroke({ width: 2, color: PHOS, alpha: 1 });
  if (inter.hovered !== null) {
    // Highlight the closest visible copy of the hovered target — the
    // pointer is over that screen position, so anchoring the marker
    // there matches what the user is looking at.
    let best: OutpostHit | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const h of outpostHits) {
      if (h.id !== inter.hovered) continue;
      const dx = h.sx - inter.currentSx;
      const dy = h.sy - inter.currentSy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = h;
      }
    }
    if (best) {
      overlay
        .circle(best.sx, best.sy, best.r + 6)
        .stroke({ width: 1.5, color: PHOS, alpha: 0.9 });
    }
    return;
  }
  // Pirate sub-target: the resolver picked an enemy sub (it was at least
  // as close as any outpost). Same +6 ring as the outpost affordance so
  // the user reads "droppable" identically regardless of target type.
  if (inter.hoveredSub !== null) {
    let best: SubHit | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const h of subHits) {
      if ((h.id as unknown as number) !== (inter.hoveredSub as unknown as number)) {
        continue;
      }
      const dx = h.sx - inter.currentSx;
      const dy = h.sy - inter.currentSy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = h;
      }
    }
    if (best) {
      overlay
        .circle(best.sx, best.sy, best.r + 6)
        .stroke({ width: 1.5, color: PHOS, alpha: 0.9 });
    }
  }
}

// ============================================================================
// Pointer interaction
// ============================================================================

interface PointerCtx {
  cameraRef: MutableRefObject<Camera>;
  interactionRef: MutableRefObject<Interaction>;
  outpostHitsRef: MutableRefObject<OutpostHit[]>;
  subHitsRef: MutableRefObject<SubHit[]>;
  overlayRef: MutableRefObject<Graphics | null>;
  propsRef: MutableRefObject<PixiMapProps>;
  render: () => void;
  /** Last sub the cursor was hovering over (null = nothing). Used to
   *  de-dupe onHoverSub emissions to enter/leave transitions. */
  lastHoveredSubRef: MutableRefObject<SubId | null>;
}

function attachPointerHandlers(app: Application, ctx: PointerCtx): void {
  const stage = app.stage;

  // Drag-to-scrub throttling. The Time-Machine projection driven by
  // onDragScrub does a full `structuredClone(world)` + tick on every
  // emit (~tens of ms in late game). At pointermove rate (60-120 Hz)
  // that thrashed React state and produced a visible "blink"/jitter
  // as projections piled up faster than they could finish.
  //
  // Strategy: stash the latest desired arrivalAt in a ref; flush it
  // to React via requestAnimationFrame — so at most one setState per
  // frame, regardless of pointermove frequency. The first emit of a
  // drag fires immediately for snappy feedback; subsequent emits
  // coalesce until the next rAF tick.
  let pendingArrival: number | null = null;
  let pendingCursor: { sx: number; sy: number } | null = null;
  let rafScheduled = false;
  let firstEmitDone = false;

  const flushScrub = (): void => {
    rafScheduled = false;
    if (pendingArrival === null) return;
    const onScrub = ctx.propsRef.current.onDragScrub;
    if (onScrub !== undefined) onScrub(pendingArrival, pendingCursor);
    pendingArrival = null;
  };

  /**
   * Compute the would-be arrival time for a launch from (`srcWorld`)
   * to the cursor position (`sx`, `sy`) and queue a scrub update.
   *
   * `extraDelayMs` is added on top of travel time — used for the
   * fresh-launch 10-minute pre-launch fuse (drag-launch). For
   * drag-redirect on an already-flying sub, pass 0.
   */
  const emitDragScrub = (
    srcWorld: Coord,
    sx: number,
    sy: number,
    speedMultiplier: number,
    extraDelayMs: number,
  ): void => {
    const onScrub = ctx.propsRef.current.onDragScrub;
    if (onScrub === undefined) return;
    const cursorWorld = screenToWorld(ctx.cameraRef.current, sx, sy);
    const distance = dist(srcWorld, cursorWorld);
    const travel = travelTimeMs(distance, speedMultiplier);
    // Emit pure offset (extraDelay + travel). Caller adds this to
    // live time. See onDragScrub jsdoc above for why.
    const offset = extraDelayMs + travel;
    const cursor = { sx, sy };
    if (!firstEmitDone) {
      firstEmitDone = true;
      onScrub(offset, cursor);
      pendingArrival = null;
      pendingCursor = null;
      return;
    }
    pendingArrival = offset;
    pendingCursor = cursor;
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(flushScrub);
    }
  };

  const clearDragScrub = (): void => {
    const onScrub = ctx.propsRef.current.onDragScrub;
    if (onScrub !== undefined) onScrub(null, null);
    pendingArrival = null;
    pendingCursor = null;
    rafScheduled = false;
    firstEmitDone = false;
  };

  stage.on('pointerdown', (e: FederatedPointerEvent) => {
    if (ctx.interactionRef.current.kind !== 'idle') return;
    const sx = e.global.x;
    const sy = e.global.y;

    const target = pickTopTarget(
      ctx.outpostHitsRef.current,
      ctx.subHitsRef.current,
      sx,
      sy,
    );

    if (target?.kind === 'sub') {
      const props = ctx.propsRef.current;
      const sub = props.world.subs.find((s) => s.id === target.id);
      const owned = sub !== undefined && sub.ownerId === props.activePlayerId;
      const hasNavigator =
        sub !== undefined &&
        props.world.specialists.some(
          (sp) =>
            sp.kind === 'navigator' &&
            sp.state === 'active' &&
            sp.location.kind === 'sub' &&
            sp.location.id === sub.id,
        );
      const hasPirate =
        sub !== undefined &&
        props.world.specialists.some(
          (sp) =>
            sp.kind === 'pirate' &&
            sp.state === 'active' &&
            sp.location.kind === 'sub' &&
            sp.location.id === sub.id,
        );
      const canRedirect = hasNavigator && props.onDragRedirect !== undefined;
      const canRetargetPirate =
        hasPirate && props.onDragRetargetPirate !== undefined;
      // For OWNED subs, drag commits the action on release. For ENEMY
      // subs with a visible Navigator/Pirate, the drag is a planning
      // preview — release commits nothing. Either way the press-sub
      // state lets the rubber-band + preview tooltip kick in.
      const canCommit = owned && (canRedirect || canRetargetPirate);
      const canPreviewOnly = !owned && (hasNavigator || hasPirate);
      const canDrag = canCommit || canPreviewOnly;
      if (!canDrag) {
        // YOUR OWN pre-launch sub (inside its cancel fuse) always wins
        // the tap — it sits exactly on its source outpost by definition,
        // so the own-outpost preference below would otherwise swallow it
        // and you could never open the edit-launch sheet from the map.
        if (owned && props.world.time < sub.launchAt) {
          props.onTapSub(target.id, sx, sy);
          return;
        }
        // A non-actionable enemy sub. If it's sitting on/near one of YOUR
        // own outposts (e.g. an attacker inbound to your pirate outpost),
        // prefer starting a launch-drag from that outpost — otherwise the
        // overlapping sub swallows the gesture and you could never launch
        // a pirate at the incoming attacker. (Enemy subs over open water
        // or others' outposts still open the sub info on tap.)
        const op = pickTopTarget(ctx.outpostHitsRef.current, [], sx, sy);
        const ownOutpost =
          op !== null &&
          op.kind === 'outpost' &&
          props.world.outposts.find((o) => o.id === op.id)?.ownerId ===
            props.activePlayerId;
        if (op !== null && op.kind === 'outpost' && ownOutpost) {
          ctx.interactionRef.current = {
            kind: 'press-outpost',
            outpostId: op.id,
            sourceTx: op.tx,
            sourceTy: op.ty,
            canDrag: true,
            startSx: sx,
            startSy: sy,
            currentSx: sx,
            currentSy: sy,
          };
          capturePointer(app, e.pointerId);
          return;
        }
        props.onTapSub(target.id, sx, sy);
        return;
      }
      // Enter press-sub so the pointer either fires onTapSub on
      // release (no drag) or rubber-bands into a drag-redirect.
      ctx.interactionRef.current = {
        kind: 'press-sub',
        subId: target.id,
        canDrag: true,
        previewOnly: !owned,
        startSx: sx,
        startSy: sy,
        currentSx: sx,
        currentSy: sy,
      };
      capturePointer(app, e.pointerId);
      return;
    }

    if (target?.kind === 'outpost') {
      // Drag is ALWAYS allowed from an outpost, regardless of
      // ownership — the drag is a planning gesture that scrubs the
      // timeline to the arrival time of a hypothetical sub on this
      // trajectory. Whether the launch can actually commit on drop
      // depends on ownership + drillers; that check happens in the
      // drop handler below.
      ctx.interactionRef.current = {
        kind: 'press-outpost',
        outpostId: target.id,
        sourceTx: target.tx,
        sourceTy: target.ty,
        canDrag: true,
        startSx: sx,
        startSy: sy,
        currentSx: sx,
        currentSy: sy,
      };
      capturePointer(app, e.pointerId);
      return;
    }

    ctx.interactionRef.current = {
      kind: 'pan',
      startSx: sx,
      startSy: sy,
      startPanX: ctx.cameraRef.current.panX,
      startPanY: ctx.cameraRef.current.panY,
      moved: false,
    };
    capturePointer(app, e.pointerId);
  });

  stage.on('pointermove', (e: FederatedPointerEvent) => {
    const inter = ctx.interactionRef.current;
    const sx = e.global.x;
    const sy = e.global.y;
    // Idle hover — detect sub blip under the cursor and emit an
    // enter/leave event. Cheaper than React DOM hover (no per-blip
    // listeners). We also de-dupe on (id|null) so a still cursor over
    // a sub doesn't spam onHoverSub every frame.
    if (inter.kind === 'idle') {
      const onHoverSub = ctx.propsRef.current.onHoverSub;
      if (onHoverSub !== undefined) {
        const hit = pickSub(ctx.subHitsRef.current, sx, sy);
        if (hit !== ctx.lastHoveredSubRef.current) {
          ctx.lastHoveredSubRef.current = hit;
          onHoverSub(hit === null ? null : { subId: hit, cursor: { sx, sy } });
        } else if (hit !== null) {
          // Same sub but cursor moved — refresh tooltip position so
          // it tracks the pointer.
          onHoverSub({ subId: hit, cursor: { sx, sy } });
        }
      }
      return;
    }
    // Any non-idle interaction clears the hover tooltip — the user
    // is doing something (panning, dragging) and a stale tooltip
    // would compete with the drag-launch overlay.
    if (ctx.lastHoveredSubRef.current !== null) {
      ctx.lastHoveredSubRef.current = null;
      ctx.propsRef.current.onHoverSub?.(null);
    }

    if (inter.kind === 'pan') {
      const dx = sx - inter.startSx;
      const dy = sy - inter.startSy;
      if (!inter.moved && dx * dx + dy * dy > PAN_SLOP_PX2) inter.moved = true;
      if (inter.moved) {
        ctx.cameraRef.current.panX = inter.startPanX + dx;
        ctx.cameraRef.current.panY = inter.startPanY + dy;
        ctx.render();
      }
      return;
    }

    if (inter.kind === 'press-outpost') {
      inter.currentSx = sx;
      inter.currentSy = sy;
      const dx = sx - inter.startSx;
      const dy = sy - inter.startSy;
      if (inter.canDrag && dx * dx + dy * dy > TAP_SLOP_PX2) {
        const srcOutpost = ctx.propsRef.current.world.outposts.find(
          (o) => o.id === inter.outpostId,
        );
        const next: Interaction = {
          kind: 'drag-launch',
          sourceId: inter.outpostId,
          sourceTx: inter.sourceTx,
          sourceTy: inter.sourceTy,
          currentSx: sx,
          currentSy: sy,
          hovered: pickOutpost(ctx.outpostHitsRef.current, sx, sy, inter.outpostId),
          hoveredSub: null,
          ownedAtStart: srcOutpost?.ownerId === ctx.propsRef.current.activePlayerId,
        };
        ctx.interactionRef.current = next;
        ctx.propsRef.current.onDragChange?.(true);
        // (firstEmitDone is false at this point — the first emit in
        // emitDragScrub will fire synchronously below.)
        const overlay = ctx.overlayRef.current;
        if (overlay) {
          drawDragOverlay(
            overlay,
            next,
            ctx.propsRef.current.world,
            ctx.cameraRef.current,
            ctx.outpostHitsRef.current,
            ctx.subHitsRef.current,
          );
        }
      }
      return;
    }

    if (inter.kind === 'drag-launch') {
      inter.currentSx = sx;
      inter.currentSy = sy;
      // Resolve outpost-vs-(pirate)-sub once so the reticle, the hover
      // emit, and the release all agree on what's under the cursor.
      const dragTarget = resolveDragLaunchTarget(
        ctx.outpostHitsRef.current,
        ctx.subHitsRef.current,
        sx,
        sy,
        inter.sourceId,
        ctx.propsRef.current.world,
        ctx.propsRef.current.activePlayerId,
      );
      inter.hovered = dragTarget?.kind === 'outpost' ? dragTarget.id : null;
      inter.hoveredSub = dragTarget?.kind === 'sub' ? dragTarget.id : null;
      const overlay = ctx.overlayRef.current;
      if (overlay) {
        drawDragOverlay(
          overlay,
          inter,
          ctx.propsRef.current.world,
          ctx.cameraRef.current,
          ctx.outpostHitsRef.current,
          ctx.subHitsRef.current,
        );
      }
      ctx.propsRef.current.onDragHover?.({
        drag: 'launch',
        sourceId: inter.sourceId as unknown as number,
        target:
          dragTarget?.kind === 'outpost'
            ? { kind: 'outpost', id: dragTarget.id }
            : dragTarget?.kind === 'sub'
              ? { kind: 'sub', id: dragTarget.id }
              : null,
        cursor: { sx, sy },
        previewOnly: false, // drag-launch always commits
      });
      // Drag-to-scrub: project the timeline forward to the would-be
      // arrival time at the cursor position. Distance is measured
      // from the *grabbed tile copy* of the source — the rubber-band
      // line the user sees on screen — so arrival time tracks linear
      // drag distance. Without this the canonical-tile distance can
      // wrap around the torus and produce jumpy/chaotic times when
      // the user dragged a wrapped copy of the outpost.
      const src = ctx.propsRef.current.world.outposts.find(
        (o) => (o.id as unknown as number) === (inter.sourceId as unknown as number),
      );
      if (src !== undefined) {
        const grabbedTilePos = {
          x: src.pos.x + inter.sourceTx * MAP_SIZE,
          y: src.pos.y + inter.sourceTy * MAP_SIZE,
        };
        // Speed-aware scrub: assume the user will board the FASTEST
        // available specialist at the source. Smuggler / Admiral /
        // any local-speed boost is factored in, so the projected
        // arrival reflects the best-case load. The LaunchSheet
        // recomputes precisely once the user actually picks cargo.
        const props = ctx.propsRef.current;
        const sourceKinds: string[] = [];
        for (const s of props.world.specialists) {
          if (s.state !== 'active') continue;
          if (s.ownerId !== props.activePlayerId) continue;
          if (s.location.kind !== 'outpost') continue;
          if (
            (s.location.id as unknown as number) !==
            (src.id as unknown as number)
          ) {
            continue;
          }
          sourceKinds.push(s.kind);
        }
        const destOwnerId =
          inter.hovered !== null
            ? (props.world.outposts.find((o) => o.id === inter.hovered)
                ?.ownerId ?? null)
            : null;
        const launchSpeed = previewSpeed(
          props.world,
          props.activePlayerId,
          sourceKinds,
          destOwnerId,
        );
        emitDragScrub(grabbedTilePos, sx, sy, launchSpeed, LAUNCH_DELAY_MS);
      }
    }

    if (inter.kind === 'press-sub') {
      inter.currentSx = sx;
      inter.currentSy = sy;
      const dx = sx - inter.startSx;
      const dy = sy - inter.startSy;
      if (inter.canDrag && dx * dx + dy * dy > TAP_SLOP_PX2) {
        ctx.interactionRef.current = {
          kind: 'drag-redirect',
          subId: inter.subId,
          previewOnly: inter.previewOnly,
          anchorSx: inter.startSx,
          anchorSy: inter.startSy,
          currentSx: sx,
          currentSy: sy,
          hovered: pickOutpost(ctx.outpostHitsRef.current, sx, sy, null),
        };
        ctx.propsRef.current.onDragChange?.(true);
        // (firstEmitDone is false — the next emitDragScrub call will
        // fire synchronously, no need to prime a distance reset.)
      }
      return;
    }

    if (inter.kind === 'drag-redirect') {
      inter.currentSx = sx;
      inter.currentSy = sy;
      inter.hovered = pickOutpost(ctx.outpostHitsRef.current, sx, sy, null);
      const hoveredSub =
        inter.hovered === null
          ? pickSub(ctx.subHitsRef.current, sx, sy, SUB_DRAG_SNAP_EXTRA, inter.subId)
          : null;
      // Preview-only drags (enemy sub source) render the rubber-band
      // in the warn red so the user reads it as "what if" not
      // "committable action."
      const lineColor = inter.previewOnly ? WARN : PHOS;
      const overlay = ctx.overlayRef.current;
      if (overlay) {
        overlay.clear();
        // Simple guide line from the sub's pressed position to the cursor.
        overlay
          .moveTo(inter.anchorSx, inter.anchorSy)
          .lineTo(sx, sy)
          .stroke({ width: 1.4, color: lineColor, alpha: 0.8 });
        if (inter.hovered !== null) {
          // Highlight the candidate outpost.
          const hit = ctx.outpostHitsRef.current.find(
            (h) => (h.id as unknown as number) === (inter.hovered as unknown as number),
          );
          if (hit) {
            overlay
              .circle(hit.sx, hit.sy, hit.r + 6)
              .stroke({ width: 1.5, color: lineColor, alpha: 0.9 });
          }
        } else if (hoveredSub !== null) {
          // Highlight the candidate enemy sub — IDENTICAL visual to
          // the outpost target ring above, so the user reads the
          // affordance the same way: "this is droppable."
          const hit = ctx.subHitsRef.current.find(
            (h) => (h.id as unknown as number) === (hoveredSub as unknown as number),
          );
          if (hit) {
            overlay
              .circle(hit.sx, hit.sy, hit.r + 6)
              .stroke({ width: 1.5, color: lineColor, alpha: 0.9 });
          }
        }
      }
      ctx.propsRef.current.onDragHover?.({
        drag: hoveredSub !== null ? 'pirate-retarget' : 'redirect',
        sourceId: inter.subId as unknown as number,
        target:
          inter.hovered !== null
            ? { kind: 'outpost', id: inter.hovered }
            : hoveredSub !== null
              ? { kind: 'sub', id: hoveredSub }
              : null,
        cursor: { sx, sy },
        previewOnly: inter.previewOnly,
      });
      // Drag-to-scrub for redirect: travel time from the sub's
      // CURRENT in-flight position to the cursor, at the sub's
      // existing speed multiplier. No pre-launch fuse — a Navigator
      // redirect takes effect on the next tick.
      const sub = ctx.propsRef.current.world.subs.find(
        (s) => (s.id as unknown as number) === (inter.subId as unknown as number),
      );
      if (sub !== undefined) {
        const subPos = subPosition(
          ctx.propsRef.current.world,
          sub,
          ctx.propsRef.current.world.time,
        );
        emitDragScrub(subPos, sx, sy, Math.max(0.01, sub.speedMultiplier), 0);
      }
    }
  });

  const finish = (e: FederatedPointerEvent | null): void => {
    if (e !== null) releasePointer(app, e.pointerId);
    const inter = ctx.interactionRef.current;
    if (inter.kind === 'idle') return;
    ctx.interactionRef.current = { kind: 'idle' };
    const overlay = ctx.overlayRef.current;
    if (overlay) overlay.clear();

    const props = ctx.propsRef.current;

    if (inter.kind === 'drag-launch') {
      props.onDragChange?.(false);
      props.onDragHover?.(null);
      clearDragScrub();
      // Resolve the release target with the SAME outpost-vs-pirate-sub
      // logic the hover used, so what the reticle promised is what
      // commits. Re-resolve from the release coordinates when we have
      // them; otherwise trust the last hover state on the interaction.
      const resolved =
        e !== null
          ? resolveDragLaunchTarget(
              ctx.outpostHitsRef.current,
              ctx.subHitsRef.current,
              e.global.x,
              e.global.y,
              inter.sourceId,
              props.world,
              props.activePlayerId,
            )
          : inter.hoveredSub !== null
            ? ({ kind: 'sub', id: inter.hoveredSub } as DragLaunchTarget)
            : inter.hovered !== null
              ? ({ kind: 'outpost', id: inter.hovered } as DragLaunchTarget)
              : null;
      // Drag is always allowed (for the timeline-preview gesture),
      // but launches only commit from an outpost the active player
      // owned at drag-start with drillers to spare OR at least one
      // active specialist. We use `ownedAtStart` instead of
      // re-checking current ownership so the player can complete a
      // launch gesture even if the sim ticks during the drag and
      // the outpost changes hands. The server does the authoritative
      // ownership check in `issueLaunchOrder`.
      const src = props.world.outposts.find((o) => o.id === inter.sourceId);
      const hasOwnSpecialistHere =
        src !== undefined &&
        props.world.specialists.some(
          (s) =>
            s.state === 'active' &&
            s.ownerId === props.activePlayerId &&
            s.location.kind === 'outpost' &&
            (s.location.id as unknown as number) ===
              (src.id as unknown as number),
        );
      const launchable =
        src !== undefined &&
        inter.ownedAtStart &&
        (src.drillers > 0 || hasOwnSpecialistHere || src.ownerId === props.activePlayerId);
      if (
        launchable &&
        resolved?.kind === 'sub' &&
        props.onDragLaunchPirate !== undefined
      ) {
        // Source has a Pirate aboard and the drop landed on an enemy
        // sub — launch a pirate at it. Same gesture, target-aware.
        props.onDragLaunchPirate(inter.sourceId, resolved.id);
      } else if (launchable && resolved?.kind === 'outpost') {
        props.onDragLaunch(inter.sourceId, resolved.id);
      } else {
        // Either no destination hit, or the source isn't ownable —
        // surface the source outpost's sheet either way so the user
        // gets context (drillers, owner, threats) for the place they
        // were just inspecting.
        props.onTapOutpost(inter.sourceId);
      }
      return;
    }

    if (inter.kind === 'press-outpost') {
      const dx = inter.currentSx - inter.startSx;
      const dy = inter.currentSy - inter.startSy;
      if (dx * dx + dy * dy <= TAP_SLOP_PX2) {
        // Cluster disambiguation — if the release position is over
        // ≥2 unique outposts, defer to the App's cluster picker so
        // the user can choose which one they meant. Falls through to
        // the closest hit when there's no cluster (or no handler).
        if (props.onTapCluster !== undefined) {
          const candidates = pickAllOutposts(
            ctx.outpostHitsRef.current,
            inter.currentSx,
            inter.currentSy,
          );
          if (candidates.length > 1) {
            props.onTapCluster(candidates, {
              sx: inter.currentSx,
              sy: inter.currentSy,
            });
            return;
          }
        }
        props.onTapOutpost(inter.outpostId);
      }
      return;
    }

    if (inter.kind === 'press-sub') {
      // No drag — treat as a tap, open the sub popover.
      props.onTapSub(inter.subId, inter.currentSx, inter.currentSy);
      return;
    }

    if (inter.kind === 'drag-redirect') {
      props.onDragChange?.(false);
      props.onDragHover?.(null);
      clearDragScrub();
      // Preview-only drags (enemy sub) never commit anything.
      // Just clear and return — the tooltip already showed the
      // projected outcome during the drag, which is the whole point.
      if (inter.previewOnly) return;
      let outpostTarget: OutpostId | null = inter.hovered;
      let subTarget: SubId | null = null;
      if (e !== null) {
        outpostTarget = pickOutpost(
          ctx.outpostHitsRef.current,
          e.global.x,
          e.global.y,
          null,
        );
        if (outpostTarget === null) {
          // Same widened snap as the live drag preview so the drop
          // commits where the highlight ring just was. Exclude the
          // source sub so a drop near the source doesn't match itself.
          subTarget = pickSub(
            ctx.subHitsRef.current,
            e.global.x,
            e.global.y,
            SUB_DRAG_SNAP_EXTRA,
            inter.subId,
          );
        }
      }
      // Look up the source sub once — we use it to check Pirate
      // aboard and to validate the sub-drop target is an enemy.
      const sourceSub = props.world.subs.find(
        (s) => (s.id as unknown as number) === (inter.subId as unknown as number),
      );
      const sourceHasPirate =
        sourceSub !== undefined &&
        props.world.specialists.some(
          (sp) =>
            sp.kind === 'pirate' &&
            sp.state === 'active' &&
            sp.location.kind === 'sub' &&
            sp.location.id === sourceSub.id,
        );
      if (outpostTarget !== null && props.onDragRedirect !== undefined) {
        props.onDragRedirect(inter.subId, outpostTarget);
      } else if (
        subTarget !== null &&
        subTarget !== inter.subId &&
        sourceHasPirate &&
        props.onDragRetargetPirate !== undefined
      ) {
        // Drop landed on an enemy sub — and the source sub has a
        // Pirate aboard. Retarget the chase.
        const targetSub = props.world.subs.find(
          (s) => (s.id as unknown as number) === (subTarget as unknown as number),
        );
        if (targetSub !== undefined && targetSub.ownerId !== props.activePlayerId) {
          props.onDragRetargetPirate(inter.subId, subTarget);
        } else {
          props.onTapSub(inter.subId, inter.anchorSx, inter.anchorSy);
        }
      } else {
        // Drag didn't land on a valid outpost or enemy sub — fall back
        // to a tap on the source sub so the popover opens.
        props.onTapSub(inter.subId, inter.anchorSx, inter.anchorSy);
      }
      return;
    }

    if (inter.kind === 'pan' && !inter.moved) {
      // Down + up on empty space without dragging the camera — treat as
      // "tap empty" so the caller can deselect the current outpost / close
      // any open sheet.
      props.onTapEmpty?.();
    }
  };

  stage.on('pointerup', finish);
  stage.on('pointerupoutside', finish);
  stage.on('pointercancel', finish);

  app.canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const r = app.canvas.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const factor = Math.pow(2, -e.deltaY * 0.0015);
      zoomAround(ctx.cameraRef.current, sx, sy, factor);
      ctx.render();
    },
    { passive: false },
  );

  attachTouchGestures(app, ctx);
}

/**
 * Native two-finger pinch zoom + double-tap-to-fit for touch devices.
 *
 * Pixi's federated event system can deliver one stream of pointer
 * events well, but multi-touch gesture detection (where we need the
 * midpoint and distance between two fingers) needs the raw `TouchEvent`
 * API. We tap into that here, alongside the existing single-pointer
 * handlers in `attachPointerHandlers` — when a second finger lands the
 * stage's idle/press/pan state is cancelled so the gesture takes over,
 * and when fingers lift we hand control back to the single-pointer
 * pipeline.
 *
 * Double-tap detection: any tap within `DOUBLE_TAP_MS` and within
 * `DOUBLE_TAP_PX` of the previous tap fires `fitAll()` — a quick way
 * to reset the camera on touch without finding the small fit button.
 */
function attachTouchGestures(app: Application, ctx: PointerCtx): void {
  const DOUBLE_TAP_MS = 320;
  const DOUBLE_TAP_PX = 32;

  let pinchActive = false;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchAnchorSx = 0;
  let pinchAnchorSy = 0;

  let lastTapAt = 0;
  let lastTapSx = 0;
  let lastTapSy = 0;

  function relativeTouch(t: Touch): { x: number; y: number } {
    const r = app.canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  app.canvas.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Begin pinch. Cancel any in-progress single-pointer interaction
        // so the rubber-band / drag-launch / pan stops competing with
        // the gesture.
        ctx.interactionRef.current = { kind: 'idle' };
        const a = relativeTouch(e.touches[0]!);
        const b = relativeTouch(e.touches[1]!);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        pinchActive = true;
        pinchStartDist = Math.max(1, Math.hypot(dx, dy));
        pinchStartZoom = ctx.cameraRef.current.zoom;
        pinchAnchorSx = (a.x + b.x) / 2;
        pinchAnchorSy = (a.y + b.y) / 2;
        e.preventDefault();
        return;
      }
      // Single-finger tap — record for double-tap detection.
      if (e.touches.length === 1) {
        const t = relativeTouch(e.touches[0]!);
        const now = performance.now();
        const dx = t.x - lastTapSx;
        const dy = t.y - lastTapSy;
        if (
          now - lastTapAt < DOUBLE_TAP_MS &&
          dx * dx + dy * dy < DOUBLE_TAP_PX * DOUBLE_TAP_PX
        ) {
          // Double-tap → fit-all. Don't preventDefault here so the
          // single-tap path keeps firing for selection; fitAll just
          // reframes the camera in addition.
          ctx.propsRef.current?.onDoubleTap?.();
          lastTapAt = 0;
        } else {
          lastTapAt = now;
          lastTapSx = t.x;
          lastTapSy = t.y;
        }
      }
    },
    { passive: false },
  );

  app.canvas.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (!pinchActive || e.touches.length < 2) return;
      const a = relativeTouch(e.touches[0]!);
      const b = relativeTouch(e.touches[1]!);
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const targetZoom = pinchStartZoom * (dist / pinchStartDist);
      const factor = targetZoom / ctx.cameraRef.current.zoom;
      // Anchor the zoom around the pinch midpoint so the world point
      // under the fingers stays put. Updating the anchor as the
      // fingers move would feel "slippy"; locking it to the initial
      // midpoint matches how iOS Maps + Google Maps handle pinch.
      zoomAround(ctx.cameraRef.current, pinchAnchorSx, pinchAnchorSy, factor);
      ctx.render();
      e.preventDefault();
    },
    { passive: false },
  );

  function endPinch(e: TouchEvent): void {
    if (pinchActive && e.touches.length < 2) {
      pinchActive = false;
    }
  }
  app.canvas.addEventListener('touchend', endPinch, { passive: true });
  app.canvas.addEventListener('touchcancel', endPinch, { passive: true });
}

function capturePointer(app: Application, pointerId: number): void {
  try {
    app.canvas.setPointerCapture(pointerId);
  } catch {
    // No-op: browser may refuse if the pointer is already captured.
  }
}

function releasePointer(app: Application, pointerId: number): void {
  try {
    if (app.canvas.hasPointerCapture(pointerId)) {
      app.canvas.releasePointerCapture(pointerId);
    }
  } catch {
    // ignore
  }
}

export type { Sub, Outpost };
