# Caching and Performance

This document inventories every cache and memoisation in the codebase,
along with the invariants each one preserves. New features that touch
the hot paths listed below must check this doc — silent invalidation
bugs are the most common way performance optimisations regress
correctness.

The sim is hot. It runs:

- **Continuously on the server**: `tick(world, ...)` every 500 ms ×
  `SIM_SPEED` (`packages/server/src/main.ts:695-702`).
- **Continuously on every client**: time-machine projection (forward
  scrub) and combat preview (`packages/client/src/projection.ts`,
  `packages/sim/src/preview.ts`).
- **On demand on the server**: replay during backward time-machine
  scrubs (`/api/replay` → `replayFrom` in
  `packages/sim/src/replay.ts`).

Every cache below is in service of one of these paths.

---

## Server-side caches

### 1. Mirror-encounter cache (`packages/sim/src/tick.ts`)

**What:** the result of `earliestMirrorEncounter(world.subs, deadline)`
is cached as `cachedEncounter` at the top of the tick loop with a
`mirrorCacheValid` flag.

**Why it exists:** `earliestMirrorEncounter` is **O(M²)** over all
subs (every unordered pair is checked for an upcoming collision).
The tick loop pops one event at a time from a priority comparison of
6 helpers; without the cache, the O(M²) helper runs once per *event*,
not once per tick. With 8 subs and 40 events per tick that's ~1,120
pair checks per tick.

**Invariant:** the next mirror encounter can only become invalid when
a sub is added, removed, or has its destination / launchAt /
arrivalAt mutated. Factory cycles, sentry shots, captive resolution,
hire dispatch, drilling — none of those touch sub paths.

**Invalidation triggers** (each must set `mirrorCacheValid = false`):
- queued-order dispatch (may launch a sub)
- pending-command dispatch (may launch / redirect)
- mirror-route encounter resolution (removes both subs)
- pirate intercept (removes target sub, may remove pirate)
- sub arrival (removes the arriving sub; combat may remove specialists)

**When adding a feature that mutates `world.subs`** (push/splice/
destinationId/arrivalAt/launchAt write), invalidate this cache.

---

### 2. Lazy per-player caps and stockpiles (`packages/sim/src/tick.ts`)

**What:** two `Map<PlayerId, number>` — `caps` and `stockpiles` —
local to each `tick()` call. Entries are **only** populated when
`runFactoryCycle` calls `caps.get(owner)` / `stockpiles.get(owner)`
and finds the entry missing; on miss the helper calls
`electricalOutput(world, owner)` / `totalDrillers(world, owner)` and
fills the entry. Entries are deleted (invalidated) by event branches
that could have changed them.

**Why it exists:** the old code rebuilt both maps for every player
after every event. At 10 players × 40 events per tick that's 400
full-world `electricalOutput` walks (each O(outposts × specialists))
per tick. The vast majority of events only affect one player.

**Invariant:** `caps.get(owner)` and `stockpiles.get(owner)` are
either absent (recompute lazily) or correct for that player at
`world.time` *as of the most recent invalidation point*. Since the
only consumer is `runFactoryCycle`, the "as-of" point is "just
before this factory cycle fires".

**Invalidation triggers** (delete the affected player's entries):
- Queued/pending dispatch (any kind) → `caps.delete(ownerId);
  stockpiles.delete(ownerId)`.
- Mirror encounter → `caps.delete(aOwner); caps.delete(bOwner)`
  (specialist captives may flip; outpost garrison untouched).
- Pirate intercept → same as mirror encounter (caps only).
- Sentry shot → no invalidation needed (`totalDrillers` doesn't
  count sub.drillers; caps unaffected).
- Sub arrival → delete attacker + old-destination owner + gift
  recipient (if any). All three caps + stockpiles entries.
- Factory cycle → stockpiles entry for the producing owner is
  updated in place by `runFactoryCycle`; caps untouched.

**When adding a feature that changes `electricalOutput` or
`totalDrillers` inputs**, invalidate the affected player's entries in
the corresponding tick branch. If the feature introduces a new event
type, add its handler with the right `caps.delete` /
`stockpiles.delete` calls.

---

### 3. WebSocket broadcast per-player cache (`packages/server/src/main.ts:678-696`)

**What:** inside `broadcastState()`, a `Map<PlayerId | null, string>`
caches the stringified state-message for each unique `playerId`
across the broadcast. The cache lifetime is one broadcast call.

**Why it exists:** `stateMessageFor` calls
`viewForPlayer(world, playerId)` (fog-of-war filter) plus
`JSON.stringify` on the resulting full world. With multiple
clients viewing the same player (or several spectator clients with
`playerId === null`), the old code did the work once per client.

**Invariant:** within one synchronous `broadcastState()` call, every
client viewing player P sees byte-identical state. (They must, for
fairness.)

**When adding a feature that should send a different payload per
client**, add a new keying dimension to the cache — `playerId` alone
is the natural one. Per-client deltas (sequence numbers, etc.) would
require a different cache shape.

---

### 4. Specialist-by-outpost index (`packages/sim/src/specialists.ts:341-369`)

**What:** `specialistsByOutpostIndex(world)` returns a
`Map<number, Specialist[]>` built in a single O(specialists) pass.
Used by `electricalOutput` (`packages/sim/src/production.ts:34-50`)
to look up specialists at each outpost.

**Why it exists:** `electricalOutput` iterates all owned outposts and
calls `specialistsAtOutpost` (itself O(specialists), allocates an
array) per outpost. Index converts the total work from
O(outposts × specialists) to O(outposts + specialists).

**Invariant:** the index is built fresh per call. The caller never
holds it across mutations.

**When adding a hot loop that calls `specialistsAtOutpost` per
outpost**, build a `specialistsByOutpostIndex` once at the top of
that loop and reuse it. Don't try to memoise across calls — the
specialist `location` field is mutated all over the sim.

---

### 5. Cached sonar radius per owned outpost (`packages/sim/src/visibility.ts:64-110`)

**What:** inside `outpostsInSonarOf` and `subsInSonarOf`, the
squared sonar radius per owned outpost is precomputed into an `r2`
array before the candidate loop runs.

**Why it exists:** `sonarRange` does an `activeCountOf` scan
(O(specialists)) and a `specialistsAtOutpost` scan (O(specialists))
per call. Without precomputation, it was called N × |owned| times
per `viewForPlayer` (N candidates × ~5 owned outposts).

**Invariant:** the radii in `r2` are valid for one `viewForPlayer`
call. They reflect the live state at call time.

**When adding a feature that modifies `sonarRange`** (new sonar
multiplier specialist, etc.), the precomputed `r2` array
automatically picks it up because `sonarRange` is called fresh.

---

## Client-side caches

### 6. Shared-clone will-lose preview (`packages/client/src/PixiMap.tsx`, `packages/sim/src/preview.ts`)

**What:** `simulateMultipleSubArrivals(world, subs)` does **one**
`structuredClone(world)`, sorts subs by `arrivalAt`, then ticks
through arrivals in order — returning a `Map<subId → ArrivalPreview>`.
PixiMap uses this instead of one `simulateSubArrival(world, sub)`
per inbound sub.

**Why it exists:** the will-lose marker on enemy subs refreshes at
1.5 s. `simulateSubArrival` clones the entire World per call. With
N inbound subs, that's N × clone-of-megabytes per refresh — the
single biggest GC pressure source in a long mid-game.

**Pre-filter** (also in `PixiMap.tsx`):
- Skip reinforcements (`dst.ownerId === sub.ownerId`)
- Skip dormant captures (`dst.ownerId === null`)
- Skip gifts (`sub.giftTo !== undefined`)
- **Skip arrivals further than `WILL_LOSE_HORIZON_MS = 12h` away** —
  distant subs don't drive immediate decisions, so we don't pay to
  project them.

**Invariant:** each returned preview's `outcome` matches what
`simulateSubArrival(world, sub)` would have returned **for the first
sub in chronological order**. Later subs in the same batch share the
clone, so they see the effects of earlier arrivals — which is
*correct* behaviour (matches what would actually happen at tick
time), not a bug.

**When adding a per-sub projection feature**, decide:
- *Do I need standalone-world projection per sub?* Use
  `simulateSubArrival` (one clone per sub, expensive).
- *Am I computing a UI flag for many subs at once?* Use
  `simulateMultipleSubArrivals` (one shared clone, chained).

---

### 7. Pixi scene-graph stability (`packages/client/src/PixiMap.tsx`)

**What:** one `OutpostNode` / `SubNode` per entity, created on first
sight and reused across frames. Each node caches a `lastKey` /
`hullKey` diff string; `Graphics.clear()` + redraw only fires when
the key changes.

**Why it exists:** Pixi 8 does not destroy children on
`scene.removeChildren()`, and `Text` textures leak. Stable nodes are
cheaper to update and avoid leaks.

**Invariant:** every visible entity has exactly one node in the
scene graph. Nodes are reused; mutations push diffs in.

**When adding a new visual layer** (new event pulse, new specialist
glyph), follow the same pattern: stable container + diff-key for
redraw.

---

### 8. React memoisation in App (`packages/client/src/App.tsx`)

**What:**
- `pickerMode`, `handleDragLaunch`, `handleDragRedirect`,
  `handleTapEmpty`, `handleOpenSheet`, `handleZoomIn/Out/Fit` are
  `useMemo` / `useCallback`'d above the early-return.
- `FABStack` is wrapped in `React.memo` and receives only scalar
  props (`myQueued`, `unread`, `hireReady`, `activeSheet`,
  `unreadEvents`) — not the full `World`.
- HUD-derived counts (`factories`, `mines`, `ownedCount`,
  `myQueued`, `unreadMessages`) are computed via single O(N) passes
  rather than multiple `.filter` walks.

**Why it exists:** every WebSocket state push re-renders `App`.
Without memoisation, every child component would re-render and
PixiMap's `useEffect` would re-fire its will-lose pipeline.

**Invariant on hooks**: every `useMemo`/`useCallback`/`useEffect`
*must* sit above the early-return at line ~256
(`if (!world || !liveWorld) return ...`). React hooks order must be
stable between renders. Adding a hook below the early-return crashes
the app with "Rendered more hooks than during the previous render" —
verify with a fresh-page load after adding.

**When adding a new memoised value or callback**, place it in the
hook block above the early-return. If the callback closes over
`world`, mark `world` (the post-loading variable) as the dep — but
prefer to thread a derived scalar (e.g. one outpost's drillers)
through the dep array so the callback identity changes only on the
relevant input.

---

## Not cached (and why)

### Sub positions

`subPosition(world, sub, now)` is called many times per render
frame and per tick. We do **not** cache it. Reasons:
- `now` differs per call (interpolated for in-flight subs).
- Caching the function output by `(sub.id, now)` would need
  invalidation on `sub.destinationId` / `chase` / `speedMultiplier`
  changes; the bookkeeping isn't worth the speedup at typical sub
  counts.
- The function itself is cheap (two outpost lookups + linear
  interpolation + torus delta).

### Visibility set (`outpostsInSonarOf`, `subsInSonarOf`)

We could cache "what player P sees" between WebSocket broadcasts,
but every sub-arrival moves a position, and the set invalidates
whenever a sub crosses a sonar boundary. The discovered-locations
`Player.knownOutposts` array is the *persistent* memory; recomputing
the *current* set per broadcast is correct and cheap enough.

### `world.events` log filter (`eventsForPlayer`)

`world.events.filter(e => e.visibleTo.includes(viewerId))` is a
straight linear filter per broadcast per client. It's cheap because
`world.events` is bounded by `MAX_EVENTS = 100`.

---

## Rules of thumb when adding new features

1. **If you mutate `world.subs`, invalidate the mirror-encounter
   cache** (`mirrorCacheValid = false` in the appropriate tick
   branch).

2. **If you change something that affects `electricalOutput` or
   `totalDrillers` for a player, delete that player's entries in
   `caps` / `stockpiles`** at the tick branch where the change fires.

3. **If you add a new SimEvent kind, set `visibleTo` correctly at
   emit time.** The event-log filter (`eventsForPlayer`) is the only
   gate; it does no geometry.

4. **If you add a new client-side hot path that walks the world,
   look at the `specialistsByOutpostIndex` pattern**: build an index
   once, reuse it inside the loop.

5. **If you add a new component that consumes `world`, decide
   whether it needs all of `world`** or just a few scalars. If
   scalars, pass them as scalar props and memoise the component
   with `React.memo`.

6. **Never put a `useEffect` / `useMemo` / `useCallback` after the
   `if (!world || !liveWorld) return …` early-return in `App.tsx`.**
   Hooks order must be stable across renders.

7. **Don't add cross-tick memoisation in the sim** unless you can
   prove the invariant survives every sim mutation. The sim is
   shared between server and client; a stale cache there is a
   determinism bug.

8. **`structuredClone` of `World` is expensive and grows with
   game length.** Avoid it in client render loops. Use
   `simulateMultipleSubArrivals` for batch projections; reach for
   single-clone projections only for one-shot user actions
   (combat preview on the launch sheet, time-machine scrub).

9. **When in doubt, write a determinism test.** See
   `packages/sim/test/tick-optimizations.test.ts` for the template:
   run the same input through the optimised path and a slower path
   and assert byte-identical world state.
