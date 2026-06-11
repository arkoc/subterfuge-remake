# Subterfuge Remake

A from-scratch recreation of [Subterfuge](https://subterfuge-game.com/) — the
2015 week-long real-time strategy game by Ron Carmel and Noel Llopis.
TypeScript monorepo: a pure deterministic simulation shared by an
authoritative server and a Pixi-rendered web client with a Time Machine
(scrub the timeline into the past and the projected future).

![icon](packages/client/public/apple-touch-icon.png)

## Packages

```
packages/
  sim/      — pure TypeScript game simulation, authoritative on rules
              (shared verbatim by server + client; fully deterministic)
  server/   — Node host (Hono + ws + better-sqlite3): owns the canonical
              world, ticks the sim, persists an event log (source of
              truth), streams fog-of-war-filtered views per player
  client/   — Vite + React 18 + Pixi 8 web client; re-runs the sim
              locally for Time Machine future projection
```

The dependency direction is strict: `sim → server`, `sim → client`.
The sim depends on nothing.

## Run locally

Prereqs: **Node ≥ 20** and **pnpm 9** (`corepack enable` is the easy way).

```bash
pnpm install
pnpm dev
```

That starts both:

- **server** on [http://localhost:3030](http://localhost:3030) — creates a
  fresh 4-player world in `packages/server/data/subterfuge.db` on first boot
- **client** on [http://localhost:5173](http://localhost:5173)

Open the client and you're player A. Use the player switcher (top-right
badge) to act as the other seats — handy for staging fights against
yourself.

### Useful dev knobs (env vars for `pnpm dev:server`)

| Var | Default | Meaning |
|---|---|---|
| `SIM_SPEED` | `1000` | Sim-ms per real-ms. `1000` → one 24h game day ≈ 86 s. Use `2` to play the 10-minute cancel windows in real-ish time, `120` for a brisk test pace. |
| `PORT` | `3030` | Server HTTP/WS port. |
| `DB_PATH` | `./data/subterfuge.db` | SQLite location. Delete the file to wipe the world. |

```bash
# example: server at 120× with a fresh world, client in another shell
rm -f packages/server/data/subterfuge.db*
SIM_SPEED=120 pnpm dev:server
pnpm dev:client
```

## Everyday commands

```bash
pnpm build                # build all three packages
pnpm typecheck            # tsc --noEmit per package
pnpm lint                 # eslint (strict — see sim purity below)
pnpm format               # prettier --write .
pnpm test                 # vitest, all packages (sim has 400+ tests)

# single package / single test
pnpm --filter @subterfuge/sim test
pnpm --filter @subterfuge/sim test combat
pnpm --filter @subterfuge/sim test -- -t "shield recharge"

# determinism / debug helpers
pnpm sim:print            # print a generated world
pnpm sim:scenario         # run a scripted scenario
```

## Architecture in one paragraph

The sim is a pure function of its inputs: time enters as a parameter
(`tick(world, dtMs)`), randomness comes from a seeded PRNG, and ESLint
forbids Node/browser APIs, `Date`, and `Math.random` inside
`packages/sim/src/**`. The keystone property — enforced by
`tick-split-invariance.test.ts` — is that `tick(w, a+b)` is bit-for-bit
identical to `tick(w, a); tick(w, b)` for any split. That's what lets the
server's **event log be the source of truth** (boot recovery and
`/api/replay` rebuild any past moment exactly) and lets the client run
the **same sim code** to project the future for the Time Machine.

## Where the rules live

`docs/` is the spec, and it wins over code when they disagree:

- [`docs/00_overview.md`](docs/00_overview.md) — big picture, victory, pillars
- [`docs/README.md`](docs/README.md) — quick-reference number table +
  "things that are *not* in Subterfuge"
- one doc per subsystem (outposts, subs, combat, specialists, mining,
  visibility, time machine, diplomacy, lifecycle, caching) — see the table
  in [`CLAUDE.md`](CLAUDE.md)

## Conventions worth knowing before your first PR

- Sim numeric state that compounds is **integer / fixed-point** (Neptunium
  is tracked in thousandths of a kg). No float accumulation.
- IDs are **branded numeric types** (`PlayerId`, `OutpostId`, `SubId`) —
  use the helpers in `packages/sim/src/types.ts`, don't cast.
- The map is a **torus**: use `torusDelta` / `dist` / `virtualDestination`
  from `packages/sim/src/geometry.ts` instead of hand-rolled wrap math.
- Read [`docs/11_caching_and_performance.md`](docs/11_caching_and_performance.md)
  before touching `tick.ts`, `preview.ts`, `visibility.ts`, or the client
  render path; read the "Client map" section of [`CLAUDE.md`](CLAUDE.md)
  before touching `PixiMap.tsx`.

## License

TBD.
