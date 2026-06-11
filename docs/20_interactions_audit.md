# Interactions Audit

A complete catalog of every map/sheet/keyboard interaction the client supports, what each one *should* do, and the current implementation status. Use this when adding a new interaction to make sure it follows the existing patterns; use it as a checklist when verifying the UI is consistent.

---

## 1. Mental model

The client has **three input modalities**:

| Modality | Trigger | Result |
|---|---|---|
| **Tap** | Single click, no drag past `TAP_SLOP_PX2` | Open a sheet OR commit a pre-selected action |
| **Drag** | Click + move past `TAP_SLOP_PX2` | Direct manipulation: launch / redirect / retarget / pan / scrub |
| **Picker mode** | Tap an "intent" button → mode active → tap a target | Same as a drag, just split across two taps. Mode banner shows current intent. |

For every action, **drag and picker-mode are equivalent paths**. Drag is faster; picker mode is discoverable and accessible on touch.

The map is a **torus**. Every distance / position calc must use `torusDelta` / `distSquared` (both wrap-aware). Raw `x2 - x1` is a bug — see `combat.ts` history.

The sim is **continuous time**. The 10-minute number in the UI is a *per-command cancel window* (`PENDING_DELAY_MS`), not a global tick. Dev `SIM_SPEED=1000×` collapses that window to ~0.6 real-sec; production runs at 1×.

---

## 2. Source × Target × Modifier matrix

What each combination of `(source, target, modifier)` does. "Modifier" = scrubber state, picker mode, etc.

### 2.1 Source = own outpost (drag-launch)

| Target | Modifier | Action | Sheet |
|---|---|---|---|
| Own outpost | live | Reinforce launch | LaunchSheet (mode=now) |
| Own outpost | scrubbed forward | Queue reinforce at scrub time | LaunchSheet (mode=queue) |
| Enemy outpost | live | Attack launch | LaunchSheet (combat preview) |
| Enemy outpost | live + Pirate aboard | Same as above; Pirate auto-targets *no one* unless drag dropped on a sub | — |
| Enemy outpost | live + gift toggle | Gift to outpost owner | LaunchSheet (mode=now, gift) |
| Dormant outpost | live | Claim / capture launch | LaunchSheet |
| Enemy sub | live + Pirate at source | Launch sub + auto-attach pirate-target | LaunchSheet (prePiratedTargetSubId set) |
| Enemy sub | live + no Pirate | Falls through to "tap source" (opens OutpostSheet) | OutpostSheet |
| Empty space | any | Drop = "tap source" → opens OutpostSheet | OutpostSheet |

Source preconditions: `src.ownerId === activePlayer && (src.drillers > 0 || hasOwnSpecialistHere)`. If neither, drag falls through to tap (open OutpostSheet). See `PixiMap.tsx:3151`.

### 2.2 Source = own in-flight sub (drag-redirect / drag-retarget)

| Target | Modifier | Action |
|---|---|---|
| Outpost | Navigator aboard | Issue redirect → 10-min pending |
| Enemy sub | Pirate aboard, chase phase=chasing or no chase | Issue pirate-target → 10-min pending |
| Outpost | no Navigator | Press treated as tap → opens SubPopoverSheet |
| Enemy sub | no Pirate | Press treated as tap → opens SubPopoverSheet |
| Self (source sub) | any | Drop on self → opens SubPopoverSheet |
| Empty space | any | Drop on empty → opens SubPopoverSheet |

Source preconditions: `sub.ownerId === activePlayer && (hasNavigator || hasPirate)`. If neither, press → tap. See `PixiMap.tsx:2837`.

### 2.3 Source = enemy in-flight sub (preview-only drag)

| Target | Action |
|---|---|
| Outpost | Show combat-projection tooltip for "if they redirect here" |
| Sub (any) | Show pirate-projection tooltip |
| Drop | **Nothing committed** — preview only |

Source preconditions: `sub.ownerId !== activePlayer && (hasVisibleNavigator || hasVisiblePirate)`. Rubber-band line is **warn red** (vs phosphor green for own subs) to signal "what-if, not committable." See `PixiMap.tsx:2851`.

### 2.4 Source = empty map space

| Target | Action |
|---|---|
| any | Pan camera (or tap empty = deselect) |

Pinch with 2 fingers = zoom. Wheel = zoom. Double-tap = `fitAll()`.

### 2.5 Source = time scrubber

| Action | Effect |
|---|---|
| Drag thumb left | Scrub to past → fetches replay from server, renders historical map |
| Drag thumb right | Scrub to future → projection.ts runs sim locally |
| Tap LIVE button | `setScrubAnchorAt(null)` → back to live |
| Keyboard `L` | Same as LIVE button |

---

## 3. Tap (no drag) interactions

| Tap target | Modifier | Action |
|---|---|---|
| Outpost | no picker mode | Open OutpostSheet |
| Outpost | picker mode = launch | Commit launch from picker source to this outpost |
| Outpost | picker mode = redirect | Commit redirect to this outpost |
| Sub | no picker mode | Open SubPopoverSheet |
| Sub | picker mode = pirate | Commit pirate-target to this sub |
| Empty | no picker mode | Deselect / close sheet |
| Empty | any picker mode | (no-op or cancel) |
| Cluster of outposts (≥2 in hit zone) | no picker mode | Open ClusterTapPicker overlay |

---

## 4. Sheet behaviors

All sheets follow the same skeleton: header (title + meta + ✕ close), scrollable body, optional button row.

| Sheet | Trigger | Body content | Buttons | Scrubbed mode behavior |
|---|---|---|---|---|
| **OutpostSheet** | Tap outpost | name, kind, garrison, contribution rate, drill button | Drill | Drill becomes "queue drill" |
| **LaunchSheet** | Drag-launch / picker-mode commit | drillers slider, specialists toggles, combat preview, gift toggle, "launch now / queue" toggle | Cancel / Launch | "queue" toggle visible, button label "queue" |
| **HireSheet** | Tap HIR FAB / next-event chip | 3 candidates + coming-next + promote options | per-row, no separate bottom bar | Title changes to "queue hire", commits via `postQueueHire` |
| **QueueSheet** | Tap QUE FAB | pending + queued orders list, finalize-now button (hire only) | Cancel per row | n/a — always shows live queue |
| **FleetSheet** | Tap FLT FAB or HUD stockpile/kg | leaderboard sorted by neptunium | — (funding removed, docs/21) | n/a |
| **ChatSheet** | Tap MSG FAB | scrolling log + composer + @ mention popover | Send | n/a |
| **SubPopoverSheet** | Tap a sub | identity, cargo, route, combat preview, redirect/pirate-target action buttons | per-action | n/a |
| **EventsSheet** | Tap LOG FAB | filtered event log (combat / sentry / diplomacy / all) | jump-to per row | n/a |
| **HelpSheet** | Tap ? button | how-to-play sections | n/a | n/a |
| **PlayerSwitcherSheet** | Tap player chip (DEV) | list of players | per-row select | n/a |

**Sheet auto-close triggers:**
- ✕ button
- `Esc` key
- Successful action (most sheets)
- Drag starts on map (App's `onDragChange(true)` calls `setSheet(null)`)
- Cluster picker activation

---

## 5. Picker mode banners

A picker-mode banner appears at the top when waiting for a target tap. Tap the banner = cancel. Tap a target = commit.

| Picker | Source | Banner text | Banner color |
|---|---|---|---|
| `'launch'` | An owned outpost | "tap target outpost · or drag from any owned" | warn/orange |
| `'redirect'` | An owned in-flight sub w/ Navigator | "redirect — tap a new destination outpost" | warn |
| `'pirate'` | An owned in-flight sub w/ Pirate | "pirate target — tap an enemy sub" | crit/red |

`Esc` cancels any picker mode.

---

## 6. Drag feedback / affordances

| Phase | Visual |
|---|---|
| Press-down (no movement yet) | none (could be a tap) |
| Past `TAP_SLOP_PX2` (~14px) | Rubber-band line starts drawing from anchor to cursor |
| Hovering outpost target | Phosphor ring at `outpost.r + 6` around hovered outpost |
| Hovering enemy sub target (with `SUB_DRAG_SNAP_EXTRA=14`) | Double phosphor ring (`+4` inner + `+9` outer) around sub |
| Drop on valid target | Action commits via callback |
| Drop on invalid target / empty | Treated as a tap on the source |
| Preview-only drag (enemy source) | Rubber-band line is **warn red**; on drop, nothing commits |

Time scrubber tether: a faint dashed line drops from cursor to the scrubber strip showing projected arrival time. See `App.tsx:onDragScrub`.

---

## 7. Toast / notification rules

| Trigger | Toast level |
|---|---|
| Action API returns `{ok:false}` | `error` (red) |
| Time-Machine queue order succeeds | `info` "queued for t+…" |
| Pirate-picker handoff after launch | `info` "tap target enemy sub for pirate" |
| Sim event with viewer in `visibleTo` | `info` with event summary |
| `order_failed` sim event | `info` (severity: bad) — surfaces pending-command fire-time failures |
| Pending hire/promote/drill committed | **no toast** — Orders sheet IS the confirmation |

Toast TTL handled by `pushToast` in `App.tsx`.

---

## 8. Known-good interaction sequences (verify these work)

### 8.1 Standard attack
1. Drag from own outpost → enemy outpost
2. LaunchSheet opens, slider set, optional specialists checked
3. Submit → sub appears as pre-launch dot at source
4. 10 sim-min later, sub departs
5. At arrival, combat resolves; event log shows combat_outpost

### 8.2 Pirate intercept
1. Pirate aboard an in-flight sub (or launched with one)
2. Drag from the pirate sub onto an enemy sub
3. Pirate-target order queued for 10 sim-min in Orders sheet
4. Order fires → `sub.chase` set, arrivalAt rewritten to intercept time, speed → 2×
5. At intercept time, combat fires; pirate returns home if surviving

### 8.3 Navigator redirect
1. Sub launched with Navigator → in flight
2. Drag from the sub onto a different outpost
3. Redirect queued for 10 sim-min in Orders sheet
4. Order fires → sub's destinationId + arrivalAt rewritten
5. Sub arrives at new destination

### 8.4 Time Machine queue
1. Drag scrubber to a future moment
2. Drag from own outpost → enemy outpost
3. LaunchSheet opens in queue mode
4. Submit → entry in Orders sheet
5. When live time reaches `executeAt`, queued launch fires
6. (If source's drillers are insufficient at that moment, queued order silently drops — TODO: surface this too)

### 8.5 Defender preview
1. See enemy sub w/ Navigator in your sonar
2. Press + drag the enemy sub onto your outpost
3. Red rubber-band + combat-projection tooltip ("ATK 20 → DEF 18 · ✗ LOST · 6 take it")
4. Release → nothing commits

### 8.6 Specialist-only launch
1. Outpost has 0 drillers but a Pirate stationed
2. Drag from outpost → enemy outpost
3. LaunchSheet opens with slider at 0 ("none" preset highlighted)
4. Check the Pirate to board
5. Submit button enables → launch fires with 0 drillers + Pirate aboard

---

## 9. Gaps / asymmetries / things that could be cleaner

This is the working list of "doesn't feel right yet."

### G1. Drag-launch scrub doesn't preview speed
Drag from outpost uses base speed `1.0×` for the time-scrubber projection — doesn't preview Smuggler/Pirate speed boosts. LaunchSheet recomputes correctly once the user picks specialists. (See task #224.)

### G2. Picker-mode + drag = two ways to do the same thing
Pirate picker (`pickingPirateFor` state + mode banner + tap-target) and pirate retarget drag both fire the same `postPirateTarget`. Maintaining both = more code + more failure modes. **User confirmed keeping both** for now.

### G3. Order failures previously silent
Just fixed via `order_failed` sim event. Verify in browser once a failure happens.

### G4. Queue mode + Pirate banner mismatch
Fixed — banner now only shows in `mode === 'now'`.

### G5. Tap on cluster picker can be missed
If two outposts overlap within hit radius, tapping fires `onTapCluster` instead of `onTapOutpost`. Picker is fine on desktop, but on touch the picker overlay can be tappy.

### G6. Sub popover combat preview is "snapshot at arrival" — doesn't show intermediate sentry shots
SubPopoverSheet uses `simulateSubArrival` (terminal projection). Doesn't preview sentry hits en route. Minor — the user can read the route + sentry icons themselves.

### G7. Esc key behavior conditional cascade
`App.tsx:175-195` walks through picker modes / cluster taps / palette to decide what Esc closes. Hard to reason about. Adding a 4th picker would compound the cascade.

### G8. Queue badge on FAB only counts queued orders, not pending
The QUE FAB shows the count of `myQueued.length`, not `myPending.length`. So a pending hire doesn't visually bump the FAB. Inconsistency with the Orders sheet header `"N pending · M scheduled"`.

### G9. Preview-only drag from enemy sub has no labeled affordance
The red rubber-band is the only signal that the drag is preview-only. A small "preview" label near the cursor or a different cursor would make it more obvious. Currently the user might think they've issued an order.

### G10. Sub-vs-sub combat preview is sub-popover-only
There's no way to scrub the time forward and preview a sub-vs-sub mirror encounter inline on the map — you have to tap the sub to see it. Could add a "predicted combat at T" pulse on the map.

---

## 10. Architecture invariants — do not break

These are settled decisions; don't undo them without checking the history.

- **Stable scene graph** (`PixiMap.tsx` comment at top). No `scene.removeChildren()` per tick; Pixi 8 doesn't destroy children. One OutpostNode / SubNode per entity, reused.
- **Auto-ticker stays on**. Pixi 8 hit-tests against the most-recently-rendered stage; stopping the ticker breaks tap detection.
- **Camera model**: `screen = world * zoom + pan`. Single `render` entrypoint.
- **No per-outpost interactive Graphics**. Hit testing is stage-level against `outpostHitsRef` / `subHitsRef` (screen-space centers + radii baked at render time).
- **Pointer capture on drag-start** so events keep flowing across HUD overlays.
- **Toroidal wrap**: single canonical outpost render; sub trails use `virtualDestination`. Blip position is linear interp along the wrap-aware line.
- **Sim is pure / deterministic** (per ESLint rules on `packages/sim/src/**`). No `new Date()`, no `Math.random()` — seeded PRNG. Time is a parameter.

---

## 11. Verification checklist (manual)

Run through these on a fresh game; tick when verified.

- [ ] Tap an own outpost → OutpostSheet
- [ ] Tap an enemy outpost → OutpostSheet (read-only)
- [ ] Tap a fogged outpost → OutpostSheet shows redacted state
- [ ] Tap empty space → close current sheet
- [ ] Tap own sub → SubPopoverSheet with combat preview
- [ ] Tap enemy sub → SubPopoverSheet
- [ ] Drag own outpost → own outpost → LaunchSheet
- [ ] Drag own outpost → enemy outpost → LaunchSheet w/ combat preview
- [ ] Drag own outpost → dormant outpost → LaunchSheet
- [ ] Drag own outpost (has Pirate) → enemy sub → LaunchSheet w/ prePiratedTargetSubId
- [ ] Drag own outpost → empty → opens source OutpostSheet
- [ ] Drag from own Navigator-sub → outpost → redirect order
- [ ] Drag from own Pirate-sub → enemy sub → pirate-target order
- [ ] Drag from enemy Navigator-sub → your outpost → red rubber-band + preview tooltip, release does nothing
- [ ] Drag from enemy Pirate-sub → your sub → red rubber-band + preview tooltip
- [ ] Drag from 0-driller outpost (with Pirate) → enemy outpost → LaunchSheet allows 0 drillers + Pirate
- [ ] Multiple subs to same destination → multiple distinct blips visible
- [ ] Scrub forward → LaunchSheet shows queue toggle, button says "queue"
- [ ] Scrub forward → queue a launch → Orders sheet shows it; when live time reaches executeAt, sub appears
- [ ] Scrub backward → past replay loads from server
- [ ] Drag onto own sub when in pirate picker mode → commits target
- [ ] Esc cancels picker mode
- [ ] Pending command fire-time failure → `order_failed` event + toast with reason
- [ ] @-mention dropdown in chat appears with muted phosphor, not bright green
- [ ] Specialist chip wraps to multiple rows past 4 glyphs (single bracket pair)
- [ ] Captive chip appears below outpost name, tinted by original owner
- [ ] Page refresh: no orange-circle pulse storm replaying old events

---

## 12. Recommended next polish (small, focused)

1. **G1 — speed-aware drag scrub** (~20 lines): walks specialists at the source, picks max multiplier, passes it to `emitDragScrub`. (Task #224.)
2. **G8 — QUE FAB badge count** (~3 lines): include `myPending.length` in the displayed count, OR add a second indicator.
3. **G9 — preview-only "WHAT IF" label** (~15 lines): tiny floating label near the cursor during enemy-sub drag so the user reads the affordance immediately.
4. **G3 — verify**: produce a failing pirate-target in dev, see the event toast.

Bigger items (defer until needed):
- G2 picker-mode consolidation
- G7 Esc cascade refactor
- G10 inline sub-vs-sub combat preview pulse
