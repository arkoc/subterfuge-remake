# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A from-scratch recreation of *Subterfuge* (2015) — a real-time, ~7-day strategy game. TypeScript monorepo (pnpm 9 workspaces, Node ≥ 20), Vitest, ESLint 9 flat config + Prettier.

## Commands

Run from the repo root unless noted.

```bash
pnpm install              # bootstrap workspace
pnpm build                # build all three packages
pnpm typecheck            # tsc --noEmit per package
pnpm lint                 # eslint .  (strict — see "sim purity" below)
pnpm lint:fix
pnpm format               # prettier --write .
pnpm test                 # vitest run, all packages

# Single package
pnpm --filter @subterfuge/sim test
pnpm --filter @subterfuge/sim typecheck
pnpm --filter @subterfuge/client build

# Single test file / pattern (passed through to vitest)
pnpm --filter @subterfuge/sim test combat
pnpm --filter @subterfuge/sim test -- -t "shield recharge"

# Dev
pnpm dev                  # server + client, in parallel
pnpm dev:server           # tsx watch src/main.ts (port from packages/server)
pnpm dev:client           # Vite dev server

# Determinism / debug helpers
pnpm sim:print            # tsx packages/sim/scripts/print.ts
pnpm sim:scenario         # tsx packages/sim/scripts/scenario.ts
```

## Architecture

Three packages share one TypeScript build graph:

- **`packages/sim`** — pure game simulation. *Authoritative on rules.*
- **`packages/server`** — Node host (Hono + ws + better-sqlite3 + pino) that owns the canonical world, advances the sim, and ships filtered per-player views over WebSocket.
- **`packages/client`** — Vite + React 18 + Pixi 8. Renders the filtered world. Re-runs the sim locally for *Time Machine* future projection (`packages/client/src/projection.ts`).

The dependency direction is strict: `sim → server`, `sim → client`. Sim depends on nothing.

### Sim purity (enforced by ESLint, see `eslint.config.js`)

The whole point of the sim being a separate package is that **the same code runs on server and client and is deterministic**. The lint config in `eslint.config.js` enforces this for files under `packages/sim/src/**`:

- No Node built-ins (`fs`, `path`, `crypto`, `http`, …) and no Node globals (`process`, `Buffer`, `__dirname`, …).
- No browser globals (`window`, `document`, `fetch`, `localStorage`, …).
- No `new Date()` and no `Math.random()` — use the seeded PRNG in `packages/sim/src/rng.ts`. Time enters the sim as a parameter (`tick(world, dtMs)`); sim functions are pure.
- Numeric state that compounds is integer / fixed-point (e.g. Neptunium in *thousandths* of a kg).

If a lint rule fights you in sim code, the answer is almost always **move the impure call to server/ or client/ and pass the value in**.

### Server (Phase 5+)

`packages/server/src` is small — `main.ts`, `db.ts`, `index.ts`. Owns the canonical `World`, runs `tick()` from sim, filters with `packages/sim/src/visibility.ts` per player, and streams snapshots. SQLite for persistence (better-sqlite3, synchronous).

### Client map (the part that's been worked over most recently)

`packages/client/src/PixiMap.tsx` follows these architectural decisions — keep them when editing:

- **Stable scene graph.** One `OutpostNode` / `SubNode` per entity, created on first sight and reused. `Graphics.clear()` + redraw only fires when a small diff key changes (`kind|ownerId|fogged`, `shieldKind`, drillers count, etc.). Text gets `.text = …`. *Do not* go back to `scene.removeChildren()` per tick — Pixi 8 doesn't destroy children and Text textures leak.
- **Auto-ticker stays on.** Pixi 8's federated event system hit-tests against the most-recently-rendered stage; turning the ticker off (`autoStart: false` / `app.ticker.stop()`) causes outpost taps to miss because the hit cache goes stale. The cheap-idle property comes from the stable node graph, not from stopping the ticker — at idle pixi re-rasterises the same Graphics with no allocations.
- **Camera model.** `screen = world * zoom + pan`. Wheel zooms around the cursor (`zoomAround` preserves the world point under the pointer); buttons zoom around screen center. Single `render` entrypoint refreshes the drag rubber-band whenever the camera moves, so the line always tracks the source outpost's current screen position.
- **Full-screen layout.** No inset margins — HUD/scrubber/FABs/map-controls overlay on top of the canvas.
- **Outpost shapes (visual spec).** Factory = triangle, generator = circle, mine = diamond. Uniform `OUTPOST_R` for all kinds; shield strength shows via 1 vs 2 concentric rings, *not* radius.
- **Toroidal wrap.** Outposts are drawn at a single canonical position (no 3×3 tiling). Sub trails draw from `src.pos` to `virtualDestination(src.pos, dst.pos)` (from `@subterfuge/sim`) which extends off-plane for edge-crossing paths; blip position is linear-interp along that same line so trail and blip never disagree.
- **Pointer capture.** On drag/pan start the canvas calls `setPointerCapture(pointerId)` so events keep flowing even when the cursor crosses HUD/scrubber/FAB overlays. Released on `pointerup` / `pointerupoutside` / `pointercancel`.
- **Hit testing happens at stage level** against `outpostHitsRef` / `subHitsRef` (screen-space centers + radii baked at render time). *Do not* re-introduce per-outpost interactive `Graphics` for cursor affordance — it causes pointerover/out cascades and `canvas.style.cursor` thrash near clustered outposts.

## Game-mechanics reference (`docs/`)

When implementing or auditing rules, read the spec doc for that subsystem *first* — the docs are the source of truth, not the existing sim code (which may be incomplete; project is in Phase 0–5).

| Subsystem | Doc | When to read |
|---|---|---|
| Big picture, victory, design pillars | [`docs/00_overview.md`](docs/00_overview.md) | Before any architectural change |
| Outposts (Factory / Generator / Mine), shields, capture | [`docs/01_outposts.md`](docs/01_outposts.md) | Editing `packages/sim/src/{world-gen,production}.ts`, outpost rendering |
| Subs: launch / cargo / travel / redirection / gifts | [`docs/02_subs.md`](docs/02_subs.md) | Editing `packages/sim/src/subs.ts`, `orders.ts`, sub rendering |
| Driller production, electrical cap, lifecycle | [`docs/03_drillers_production.md`](docs/03_drillers_production.md) | Editing `production.ts`, HUD economy pills |
| Deterministic 4-phase combat resolution | [`docs/04_combat.md`](docs/04_combat.md) | Editing `combat.ts`, `preview.ts`, combat preview UI |
| Specialists (priorities, counters, promotion) | [`docs/05_specialists.md`](docs/05_specialists.md) | Phase 6+ specialist work |
| Mines, Neptunium formula, 20% capture penalty, victory | [`docs/06_mining_neptunium.md`](docs/06_mining_neptunium.md) | Editing `mining.ts`, `victory.ts` |
| Shields, sonar range, fog of war, mine global visibility | [`docs/07_shields_sonar_visibility.md`](docs/07_shields_sonar_visibility.md) | Editing `visibility.ts`, `shield.ts`, sonar drawing |
| Time Machine / deterministic future projection / queued orders | [`docs/08_time_machine.md`](docs/08_time_machine.md) | Editing `queued-orders.ts`, `client/src/projection.ts`, time scrubber |
| Chat, gifts, funding, captives, code of conduct | [`docs/09_diplomacy_and_communication.md`](docs/09_diplomacy_and_communication.md) | Editing `diplomacy.ts`, chat sheet, fleet sheet |
| Match config, map gen, phases, elimination | [`docs/10_game_flow_and_lifecycle.md`](docs/10_game_flow_and_lifecycle.md) | Editing `world-gen.ts`, lifecycle/elimination work |
| Caches + invalidation rules for hot paths | [`docs/11_caching_and_performance.md`](docs/11_caching_and_performance.md) | **Before** touching `tick.ts`, `preview.ts`, `visibility.ts`, `App.tsx` render path, or any sim mutation |
| Quick-reference number table (cycle times, costs, caps) | [`docs/README.md`](docs/README.md#quick-reference) | Sanity-checking magic numbers |

The "Things That Are *Not* in Subterfuge" section of `docs/README.md` lists features that get confused with this game but don't exist (tech tree, alliances, formations, etc.) — useful before chasing a phantom feature.

## Conventions worth not re-discovering

- The sim package is exported via barrel `packages/sim/src/index.ts`; clients/servers import from `@subterfuge/sim`, not subpaths.
- IDs are *branded* numeric types (`PlayerId`, `OutpostId`, `SubId`, `QueuedOrderId`) — don't cast between them; use the helpers in `packages/sim/src/types.ts`.
- The map is a **torus** of side `MAP_SIZE` (`packages/sim/src/types.ts`). Use `torusDelta`, `dist`, `virtualDestination`, `wrapCoord` from `packages/sim/src/geometry.ts` instead of writing wrap math yourself.
- Player visibility in tests / client code: when the world is the filtered per-player view, outposts may carry `fogged: true` — details (garrison, shield, queen, specialists) are zeroed; only location + owner are reliable.
