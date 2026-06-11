# 12. UI Design Reference

Authoritative design spec for every UI surface in the client. Written
from first principles — describes *intent* before *implementation*.
The codebase should match this doc; when they diverge, the doc wins
and the code follows.

For a manual test checklist see §15 at the bottom; the bulk of this
file is the per-component design, not test steps.

## Design principles

1. **Mobile-first, one-handed.** Every primary action must be reachable
   with the user's thumb on a 360×640 phone in portrait. Secondary
   actions (zoom, find-queen, switch-player) may live in the top
   corners but never block a primary action.
2. **Map is the canvas. UI floats over it.** No layout reflow on sheet
   open. Sheets, banners, ribbons overlay the map; the map keeps
   reading underneath. Backdrop dim is allowed; backdrop click-through
   is required for drag-launch from any visible outpost.
3. **Glance, then drill.** Every piece of state should be readable
   without opening a sheet at fit-to-map zoom. Sheets add detail and
   actions; they should never carry information the map can't show.
4. **Time is a first-class axis.** Drag-to-scrub from any outpost is a
   hero feature. The scrubber, the projection, and the drag gesture
   are all the same UI thought: "show me the future".
5. **Color is meaning.** Three semantic colors only: phosphor (yours /
   active / positive), warn (pending / scheduled / needs attention),
   crit (loss / threat / error). Per-player colors are a separate
   identity dimension that never collides with semantic colors. Any
   indicator that mixes 3+ concepts on the same color is a bug.
6. **One signal per concept.** A threat should appear in *one* place,
   not four. A cost should be quoted once. Duplication is friction.
7. **Indicate intent, not implementation.** A sub should look like a
   gift when it's a gift; like a reinforcement when it's reinforcing;
   like an attack when it's attacking — without opening a sheet.

## Stack

- React 18 + Pixi 8, mobile-first viewport
- WebSocket world updates from the Node server
- Deterministic local projection via `@subterfuge/sim` for the Time
  Machine

## Layout (mobile, 390×844 baseline)

```
┌──────────────────────────────────────┐
│ HUD strip (40 px)                    │ ← top-bound
├──────────────────────────────────────┤
│ [threat lane] [drag-hint]            │ ← floating overlays (top)
│                            [♛ ⌖ +-?] │ ← map-tools cluster (right)
│                                      │
│           PIXI MAP                   │
│                                      │
│        ...sub trails...              │
│           outposts                   │
│                                      │
│                                      │
│ [toasts]                             │ ← floating (above scrubber)
├──────────────────────────────────────┤
│ time scrubber                  (48px)│
├──────────────────────────────────────┤
│  msg   flt   que   hir   log   (56px)│ ← tab bar (bottom-bound)
└──────────────────────────────────────┘
```

### Desktop (≥ 720px)

Tab bar, scrubber, sheet all centre-anchor and max-width 560 px so a
desktop user sees a phone-shaped interaction zone rather than a
stretched mobile UI. Map-tools cluster gets +/− zoom buttons (pinch
replaces them on touch).

---

## Color system

| Token | Hex | Meaning | Allowed uses |
|---|---|---|---|
| `--phos` | `#7af0c8` | yours · active · positive · win | own outpost stroke, active tab, primary CTA, success toast, win outcome, drag rubber-band, sonar ring, live scrubber, hire-ready badge |
| `--phos-dim` | rgba phos 0.4 | recessed phos | borders, faint accents |
| `--warn` | `#ffb547` | pending · queue · captive · neutral-outcome | warn toast, queen tag, queued-pending order border, tie outcome |
| `--crit` | `#ff5470` | threat · loss · error | error toast, threat lane, lose outcome, danger button, hostile tag, will-lose ring |
| `--scrub-future` | `#9bdcfb` | future projection (NEW) | scrubber thumb + HUD time chrome when scrubbed forward |
| `--scrub-past` | `#c79bfb` | past replay (NEW) | scrubber thumb + HUD time chrome when scrubbed backward |
| `--cap-warn` | `#ff7a36` | electrical-cap warning (NEW) | factory paused indicator, HUD electrical pill when capped |
| `--bg-void` | `#020812` | map background base | canvas fill |
| `--bg-surface` / `--bg-surface-2` | dark blues | sheet / chip background | sheet, chip, hire-row |
| `--line-faint` / `--line-mid` / `--line-strong` | grey-blues | dividers + borders | row underline, chip border |
| `--txt` / `--txt-dim` / `--txt-mute` | text greys | body / secondary / tertiary text | per-context |

**Forbidden overloads** (any one color encoding ≥ 3 unrelated
concepts):

- ❌ `--warn` was overloaded across (scrubbed state, electrical cap,
  pending order, captive accent, lost-outpost toast, tied outcome) —
  split into `--warn`, `--scrub-future`, `--scrub-past`, `--cap-warn`.
- ❌ `--crit` will keep the threat/loss meaning unified (those are
  related). Player B's red identity uses a slightly different hue
  (`#ff7396`) to disambiguate.
- ❌ `--phos` will stay broad ("yours / positive") but `--phos-dim`
  shouldn't double for borders + recessed text. Use `--line-mid` for
  borders.

Per-player palette (`colors.ts`): 10 distinct hues, picked so no
player color matches `--warn`, `--crit`, or `--cap-warn` within ΔE > 12.

---

## Component spec

### A. HUD strip

**Intent**: show what matters *now* AND *next*. Read in one glance:
am I winning, am I capped, when's my next decision point.

**Layout** (left → right):

```
[time] [⚡ stockpile/cap] [◇ neptunium · victory bar] [next event] [player chip]
```

- **Time**: `⏱ 2d 16h`. Glyph + value. Tabular nums. Tap → opens
  Events sheet (every HUD number is a deep link, à la Solaris).
- **Stockpile**: `⚡ 304/400`. Color: phos normally, `--cap-warn`
  orange-red when stock ≥ cap (was warn-amber, freed for pending).
  Sub-label `+54/d` shows on ≥ 600px only. Tap → opens fleet sheet
  (your stats).
- **Neptunium**: `◇ 18.6 kg` with inline victory bar (filled width =
  pct of 200 kg). Bar is the same height as the value. Tap → opens
  fleet sheet to leaderboard. **The victory bar is the most important
  late-game UI element; bumped from 60×2 to 80×4 px and integrated
  into the value baseline.**
- **Next-event chip** (NEW, mid-HUD): `next: hire in 22m` or
  `next: ⚔ inbound 8m`. Shows the soonest player-relevant event:
  (incoming threat, next hire ready, next factory cycle, next queued
  order). Color matches the event kind (crit threat, phos hire,
  warn factory, scrub-future queue). Tap → opens corresponding sheet.
- **Player chip**: letter colored in own player hue + 10px swatch.
  Only clickable in `import.meta.env.DEV` for the switcher.

**Scrubbed state**: time-glyph + value go `--scrub-future` (cyan) for
forward, `--scrub-past` (purple) for backward — players can tell at a
glance whether they're projecting or replaying.

**Hidden on mobile**: brand wordmark (already gone). Production
totals (`+54/d`) hide on narrow. Page title `<title>` carries the
brand.

---

### B. Threat lane

**Intent**: ONE source of truth for "you have inbound enemies". Kills
the redundant on-outpost ⚔ badge + the toast spam + the per-sub
will-lose indicator's role in threat awareness (will-lose stays for
*outcome* preview, not threat awareness).

**Layout**: floating top-left under HUD when threats exist. Vertical
list, up to 3 most-urgent shown, "+N more" link to events sheet.

```
⚠ 2 inbound
├ THETA  · ⚔ 8m   · defender wins
├ DELTA  · ⚔ 1h2m · ⚠ will lose
└ +2 more
```

Per row:
- Outpost name
- Soonest ETA
- Outcome chip (`defender wins` / `will lose` / `coin flip` / `tie`),
  color matching outcome

Tap a row → centres the map on that outpost AND opens its sheet.
Tap "+N more" → opens events sheet.

**Removed**:
- On-outpost `⚔ 6h` red badge (PixiMap threat container). It was
  fighting the threat lane and the drillers number for the upper-
  right corner.
- The threat ribbon (the old single-line compact version) replaced by
  this multi-row lane.

**Pulse**: each row pulses on appearance (3 cycles, ~1.5s), then
settles. Updating ETA does NOT re-pulse (that was too noisy).

---

### C. Drag hint

**Intent**: surface the drag-to-launch gesture on first visit. Stays
out of the way once dismissed.

**Layout**: phosphor chip top-left, anchored below threat lane via a
shared `--alert-stack-top` CSS variable so they don't collide.

**Trigger**: shown on first session per device (localStorage flag
`subterfuge-drag-hint-seen`). Auto-dismisses after 7s OR on first
successful drag-launch.

**Second hint** (NEW): after the player's first drag-launch, a
SECOND one-shot hint appears: "drag forward to scrub the timeline"
— teaches the drag-to-scrub planning gesture. Same dismiss logic.

---

### D. Mode banner

**Intent**: when in picker mode (launch-target, redirect-target,
pirate-target), show what the player should do, plus how to cancel.

**Layout**: centred near top, below threat lane. Phosphor border for
launch picker, warn for redirect, crit for pirate (so picker type is
distinguishable at a glance, fixing the prior all-three-look-same bug).

Tap banner = cancel. Esc = cancel. Tap the source again = cancel.

---

### E. Map tools cluster

**Intent**: secondary navigation (find queen, fit map, zoom). Smaller
and quieter than the tabbar (primary action surface).

**Layout**: floating top-right, vertical stack.

Buttons:
- `♛` find queen (Q)
- `⌖` fit map (F)
- `+` zoom in (desktop only — touch uses pinch)
- `−` zoom out (desktop only)
- `?` help (toggles help sheet)

44×44 tap targets (was 36×36, sub-WCAG).

**Removed**: zoom +/- on mobile (pinch handles it). The vertical
column shrinks accordingly.

---

### F. Tab bar (primary navigation)

**Intent**: 5 sheet tabs anchored to the thumb zone. Tap to open;
tap active to close.

```
[msg] [flt] [que] [hir] [log]
```

Per tab:
- Glyph (lowercase 3-char abbreviation — visible label that doubles
  as the icon)
- Label below (10px uppercase letter-spaced)
- Badge (top-right of glyph col):
  - msg: amber dot + unread count
  - flt: usually empty
  - que: amber dot + pending+scheduled count
  - hir: phosphor `!` when hire ready
  - log: amber dot + unread events count

Active tab: phosphor top border + bg-rgba phos 0.18 + glyph text
shadow.

**Disambiguating "unread" colors**: hir uses phos (positive — you
*get* something), others use warn (action-pending or
attention-needed). No tab badge uses crit (threats live in the
threat lane, not in tabs).

---

### G. Time scrubber

**Intent**: the temporal axis. Drag forward to project the future,
drag backward to replay the past. Tap LIVE to snap back.

**Layout** (bottom strip above tab bar):

```
[LIVE / +4d12h]      [============●============]      [t=5d14h]
```

- Left tag: `LIVE` (phos) or `+Xd Yh` (scrub-future cyan) / `-Xd Yh`
  (scrub-past purple). Tap → reset to live.
- Slider track: live divider tick at the snap point; ticks every 12
  sim-hours. Fill segment between live and current value.
- Thumb: 10×24px, color matches direction (phos at live, cyan future,
  purple past). Hit area is the full scrubber height.
- Right tag (desktop only): absolute sim time `t = …`. Mobile drops
  it to free slider room.

**Drag-to-scrub coupling** (drag from outpost): while the user holds
a drag from any outpost, the scrubber thumb tracks the projected
arrival. A faint **scrub tether line** runs from the thumb up the
viewport edge to the drag cursor, making the connection visible.
Currently invisible — this is one of the highest-leverage fixes.

**Hover tooltip**: shows on hover for desktop; touch users get the
left-tag instead (no hover state on touch).

---

### H. Sheets — shell

**Intent**: contextual content for an entity or a tab. Slides up,
overlays the map (which stays draggable through a pointer-events:none
backdrop).

**Structure**:

```
┌── handle bar ────────────┐
│ TITLE              [×]   │
│ meta subtitle            │
├──────────────────────────┤
│ body (scrollable)        │
│                          │
└──────────────────────────┘
```

**Affordances**:
- Tap handle = dismiss (small bar at the top)
- Drag handle down past 80px = dismiss with follow-finger animation
- × button (top-right)
- Esc key (desktop)
- Tap a new entity on the map → replaces the open sheet (no manual
  close needed)

**Z-index**: above map (z 20), below tab bar (z 22) — so tapping a
tab while a sheet is open switches to the new sheet without closing
first.

**Sheets** (10): see H.1–H.10 below.

---

### H.1 Outpost sheet

**Title**: outpost name (lowercase). Meta: `{kind} · {ownerLetter}`.

**Body**:

```
[status: queen · hostile]   (only if applicable; chips)
garrison    42 · ▬▬▬ 30/30
contribution +6/8h          (factory) or +50 elec or +1kg/day
─ specialists ─
[♛ queen]              ACTIVE ▸
  (tap to expand: full effect text)
[★ lieutenant]         ACTIVE ▸
─ captives (if any) ─
[† assassin (B)]       converting ▸
─ buttons ─
[LAUNCH FROM HERE] (primary, if owned with drillers)
[drill mine]       (secondary, if owned + can drill + cost shown)
```

**Helpers**: "dormant — drag from your outpost here to claim",
"hostile — drag from your outpost here to attack" (single-line, only
when relevant).

**Captives**: section header in warn. Each captive row shows:
- Original owner letter + color
- Predicted resolution (`converting` phos, `releasing` warn, `captive`
  player-owner-color)
- Countdown to next tick if predictable

**Fogged variant**: shows only outpost name + kind + owner + 1-line
"fogged — full details out of sonar".

---

### H.2 Sub popover sheet

**Title**: `◐ sub from {srcName}` for in-flight, `◐ sub at {srcName}`
for queued (was internal sub #N).

**Meta**: `{status} · {ownerLetter}`.

**Body**:

```
route       SCYLLA → CALYPSO    (links — tap jumps to map)
cargo       20 drl · gift to F   (gift suffix in recipient color)
arrives     in 1h 23m
─ specialists aboard ─
[chips]
─ combat timeline ─        (only if a combat will resolve)
SubEncounterCard            (if mirror-route encounter en route)
CombatPreview (arrival)     (if attack)
─ actions (own + in-flight) ─
[redirect]      (requires Navigator)
[pirate target] (requires Pirate)
─ pre-launch (own + queued) ─
slider + spec checkboxes + apply + cancel
```

**Route names** (NEW): the src/dst row entries are tappable — tap to
centre + open that outpost's sheet.

---

### H.3 Launch sheet

**Title**: `LAUNCH ORDER`. **Meta**: `{srcName} ► {destName}`.

**Body**:

```
[travel: 8h50m]  [mode: friendly / hostile / dormant / gift]
[cargo slider]   (1..max with 25/50/75/all presets)
[source after: X drillers]   (orange if 0)
[specialists aboard]         (checkbox list with arriving-in-flight hint)
[combat preview]             (if hostile, visual bars not arithmetic)
[gift toggle]                (enemy only)
[mode toggle: now / queue]   (scrubbed only)
[CANCEL] [LAUNCH / QUEUE / GIFT]
```

**Combat preview** (redesigned, see §H.10): two stacked horizontal
bars showing drillers + shield as colored segments. The slider value
animates the attacker bar in real time. Specialist effects shown as
"badge → effect" rows ("⚔ → +10 enemy drillers", "↻ → 2× speed").

---

### H.4 Comms sheet

**Title**: `COMMS`. **Meta**: `{N} msgs`.

**Body**:

```
[channel: all | per-player]
[message log, newest at bottom]
[input + send] (send disabled if empty)
```

Currently a flat chat. Future: per-player threads, map-link sharing,
gift-sub announcement integration. Not implementing diplomacy hub
this pass.

---

### H.5 Fleet sheet

**Title**: `FLEET`. **Meta**: `all players`.

**Body**: leaderboard sorted by kg desc.

```
A Player 1 (you)        7o 0m 12.3kg
B Player 2              5o 1m 8.7kg
C Player 3              4o 0m 6.0kg
D Player 4              3o 1m 4.2kg
```

Per row:
- Owner swatch dot + letter + name + "you" tag
- Stats: outposts seen, mines seen, neptunium
- Fund button (if leader by 20kg+); shows `stop` if active

Footer: 1-line explainer (fog estimates + victory threshold).

---

### H.6 Queue sheet

**Title**: `ORDERS`. **Meta**: `{pending} pending · {scheduled} scheduled`.

**Body**: sorted by executeAt.

```
─ pending (10-min fuse) ─
| drill mine ALPHA · finalises in 7m       [cancel]
─ scheduled ─
| launch SCYLLA → CALYPSO · in 2d12h       [cancel]
| hire saboteur · in 4h                     [cancel]
```

Left border: warn for pending, phos for scheduled. Cancel button:
ghost grey, red-on-hover.

**Future redesign** (not this pass): timeline visualization horizontal
strip with order glyphs placed by executeAt.

---

### H.7 Hire sheet

**Title**: `HIRE`. **Meta**: `ready` / `in 4h` / `queen away`.

**Body**:

```
[scheduling banner if scrubbed]
[reason banner if blocked]
─ ROSTER ─
[↻ helmsman    — no CP — 2× sub speed]    [hire ›]
[$ thief       — CP 4 — +15% drillers]    [hire ›]
[⚙ tinkerer    — no CP — +3x shield elec] [hire ›]
─ ── or promote ── ─
[promote lieutenant → general]
─ COMING NEXT ─
+4h: foreman · diplomat · ...
+8h: tycoon · hypnotist · ...
```

Hire roster: glyph + name + short description on each row (long
description visible only on tap-to-expand in chips elsewhere).

---

### H.8 Events sheet

**Title**: `EVENT LOG`. **Meta**: `{N} events`.

**Body**: time + kind tag + summary, newest first.

```
[filter: all | combat | sentry | martyr | captives | promotion]  (NEW)
─ rows ─
t=2d14h [combat]  defender held THETA (15 drl remain)
t=2d12h [sentry]  sentry at MARIANA hit a sub for 2 drillers
t=2d10h [convert] saboteur converted by hypnotist
```

**Category filter** (NEW, stolen from Solaris): late-game produces
thousands of events; a chip-row filter scopes the view.

**Jump-to-location** (NEW): events with a `pos` get a small "↻"
button — tap to centre map.

---

### H.9 Help sheet

**Title**: `HOW TO PLAY`. **Meta**: `quick reference`.

**Sections** (in this order):

1. **Map** — gestures (tap, drag, pinch, double-tap)
2. **Glyphs** — outpost kinds + specialist legend (NEW: full
   specialist glyph table)
3. **Time machine** — scrub, drag-to-scrub, queue mode
4. **Combat** — phases, shields, capture
5. **Specialists** — what each role does in 1-line summaries
6. **Diplomacy** — chat, gifts
7. **Interface** — HUD, tab bar, map tools, scrubber (now matches
   reality, was stale)
8. **Keyboard shortcuts** (NEW): Q find queen, F fit, +/- zoom,
   M comms, L log, Esc cancel

---

### I. Toasts

**Intent**: short-lived event announcements. NOT for critical or
persistent state (use threat lane + sheet badges for that).

**Stack**: up to 3 visible, "+N more" overflow chip above.

**Per kind**:
- `info`: phos, 5s
- `success`: phos with deeper fill, 5s
- `warn`: amber, 9s
- `error`: red, 12s

**Position**: bottom-left, above scrubber + tab bar.

**Tap**: dismiss.

**Future**: kind-aware grouping (5 "sub launching" toasts collapse to
one with a count).

---

### J. Map — Pixi rendering

#### J.1 Background

- Radial gradient (deep void at edges to slightly lighter at centre).
- Subtle fractal-noise grain overlay.
- **NEW**: torus-seam ghost lines (3 px dashed phos at the wrap
  boundaries) so players see when they've panned into a tile copy.

#### J.2 Outpost rendering

**Per state**:

| State | Shape | Fill | Stroke | Extras |
|---|---|---|---|---|
| factory (own) | upward triangle | owner color | white 1px | drillers, specs chip |
| factory (other) | upward triangle | owner color | white 1px | drillers, specs chip |
| factory (dormant) | upward triangle | grey | white 0.7α | — |
| factory (paused, own, atCap) | upward triangle | owner color | white | small `--cap-warn` ring around body (NEW: was red dot, now a ring so it doesn't look like a threat dot) |
| generator | circle | owner color | white | inner darker dot |
| mine | diamond | owner color | white | **NEW: faint always-on phos halo ring at 1.4× radius** — communicates "globally visible to everyone" without needing the sheet |
| fogged | small dim dot | owner color (dim) | dim ring | NO specs chip, NO drillers (we don't know) |
| queen-here (own) | the kind shape | + owner color | + **gold ♛ above-right corner** (NEW: was removed; bringing back so the queen's location is pre-attentive) |
| selected | shape | fill | + white reticle brackets | + sonar bubble |
| launch source | shape | fill | + phos reticle brackets | |
| picker target (valid) | shape | fill | + dim phos ring | (NEW: out-of-range outposts get a `--txt-mute` dim ring instead) |

**Specialist chips on outposts** (NEW): the chip border now adopts
the OUTPOST OWNER'S COLOR (was always phos). Distinguishes "your
roster" from "their roster" at a glance.

**Reachable-range dimming** during launch picker: when the player
holds a drag-launch from outpost X, any outpost more than (max-
travel-from-X within 5 days) gets its body alpha dropped to 0.35.
Stolen from Solaris.

#### J.3 Sub rendering

**Hull**: top-down submarine silhouette (cigar hull + conning tower
mid-deck), heading along travel direction, in owner color.

**Per state**:

| State | Hull | Trail | Extras |
|---|---|---|---|
| in-flight (attack) | solid | solid 1px | drillers right side, specs chip left side |
| in-flight (reinforce) | solid | solid 1px | (NEW: small inner phos disc in conning tower) |
| in-flight (gift) | solid | DASHED + recipient color | (NEW: gift trail uses the recipient's color — instantly readable as "incoming friendly to me") |
| queued (pre-launch) | 0.45α | none (still at source) | no drillers label |
| chasing (pirate) | solid | dashed | red chase target reticle on target sub |
| returning (pirate) | solid | double-weight | |
| will-lose | + red stern dot | as state | (kept as outcome-prediction marker) |

**Sub trail PathManager** (NEW, stolen from Solaris): N subs on the
same source→dest geodesic draw ONE trail not N. Dramatically reduces
map clutter when fleets converge on a target.

**ETA on trail** (NEW): when the user selects or hovers a sub, its
trail gains an inline "8m" countdown near the head.

#### J.4 Specialist chip on map

(see also above — owner-color border).

#### J.5 Drag overlays

- **drag-launch**: phos line from grabbed tile to cursor, phos cursor
  ring, phos target highlight ring. NEW: **cursor tooltip showing
  arrival ETA + projected outcome** (`8h50m · will lose`).
- **drag-redirect**: same but the line color goes warn (amber) to
  distinguish from launch.
- **drag-scrub tether** (NEW): faint phos line from the scrubber
  thumb up to the drag cursor — makes the timeline-drag coupling
  visible.

#### J.6 Pulse animations

Currently kind-agnostic (all phos rings). Future per-kind:
- combat_outpost: phos for own win, crit for own loss, dim white for
  observed-foreign
- martyr_blast: red ring AT the 0.20×sonar radius (true scale, not
  just 36px symbolic)
- sentry_shot: existing tracer line (keep)
- captive_converted: spinning phos pulse
- princess_promoted: gold flare

---

### K. Onboarding

- **First load**: drag hint → "drag from one of your outposts to
  another to launch"
- **After first drag-launch**: "drag forward to scrub the timeline
  through the projected arrival" (NEW second hint)
- **Tutorial / scenario** mode: deferred

---

### L. Keyboard shortcuts (desktop)

- `Q` find queen
- `F` fit map
- `M` open comms
- `L` open events log
- `H` open hire
- `Esc` cancel picker / close sheet
- `+` / `=` zoom in
- `-` zoom out

---

### M. Indicator inventory (CHECKLIST)

Every indicator that must exist in the UI:

**HUD**:
- ✅ Time elapsed
- ✅ Drillers/cap + scrubbed-state color
- 🆕 Electrical capped — change to `--cap-warn` orange-red ring
- ✅ Neptunium + victory bar (expand bar)
- 🆕 Next-event chip
- ✅ Player chip
- ✅ Winner pill

**Threats** (consolidated into the lane):
- 🔄 Threat lane (replaces ribbon)
- ❌ On-outpost ⚔ badge (REMOVE — duplication)
- ✅ Will-lose sub stern dot (KEEP — outcome prediction)

**Map outposts**:
- ✅ Owner-colored body
- ✅ Kind glyph (factory tri / generator circle / mine diamond)
- ✅ Garrison number
- 🆕 Specialist chip (owner-color border)
- 🆕 Paused-factory indicator → ring not dot
- 🆕 Mine global-visibility halo
- 🆕 Queen-here gold glyph
- 🆕 Princess marker
- ✅ Shield rings
- ✅ Reticle (selected / launch source / picker target)
- 🆕 Out-of-range dim (during picker)
- ✅ Sonar bubble (when selected)
- ✅ Sentry inner ring (when selected)

**Map subs**:
- ✅ Hull + conning tower silhouette
- ✅ Owner color
- ✅ Drillers label
- 🆕 Specialist chip (owner-color border)
- ✅ Queued alpha
- ✅ Will-lose stern dot
- 🆕 Reinforce inner disc
- 🆕 Gift sub uses recipient-color trail
- 🆕 Trail PathManager dedup
- 🆕 ETA on trail (selected/hovered)

**Drag overlays**:
- ✅ Drag-launch line
- 🆕 Drag-launch cursor tooltip (ETA + outcome)
- 🆕 Drag-redirect amber line (color shift to distinguish)
- 🆕 Drag-scrub tether

**Pulses**:
- ✅ Generic combat pulse
- 🆕 Per-kind pulse styling
- ✅ Sentry tracer
- 🆕 Martyr blast scaled ring

**Sheets/sheet-shell**:
- ✅ Handle bar, title, meta, body, × close, swipe-down dismiss

**Scrubber**:
- ✅ Live tag (phos)
- 🆕 Scrubbed-future thumb cyan
- 🆕 Scrubbed-past thumb purple
- 🆕 Drag-scrub tether visual

**Tab bar**:
- ✅ 5 tabs with glyph + label + badge
- ✅ Active state phos fill

**Map tools**:
- ✅ 5 buttons; +/- mobile-hidden
- ✅ Tap feedback

**Mode banner**:
- 🆕 Per-mode color (phos launch, amber redirect, red pirate)

**Toasts**:
- ✅ Per-kind colors + timings
- 🔮 Kind-aware grouping (FUTURE)

**Specialist chips** (in sheets):
- ✅ Glyph + name + short
- ✅ Tap to expand long
- ✅ Status badge
- ✅ Foreign-owner accent

**Captives**:
- ✅ converting / releasing / captive labels
- 🆕 Countdown to next tick

---

## 15. Manual test checklist

1. Fresh load shows drag hint.
2. Tap outpost → outpost sheet opens with full state.
3. Drag from outpost to outpost → launch sheet appears, scrubber
   shows projected arrival.
4. Open tab → sheet appears above tab bar; tap active tab closes it.
5. Swipe handle down 100px → sheet dismisses.
6. Scrub forward 2h → HUD time goes scrub-future cyan, map projects.
7. Inbound enemy sub → threat lane appears with row(s); per-outpost
   badge does NOT appear.
8. Capped electricity → HUD stockpile rim glows cap-warn orange-red.
9. Pirate target picker → mode banner shows crit border.
10. Mine outpost on map → faint always-on halo visible.
11. Hover own sub trail → ETA appears inline.
12. Tap a player chip in HUD → no-op in production, switcher in DEV.

---

## Future / not in scope

- Comms threading / per-player threads
- Queue timeline visualization
- Combat preview animated bars (Phase 3)
- Tutorial / scenario mode
- Tab badge: fleet "events that affect you" hint
