# 22 — Road to a Complete Game

What stands between the current build (one dev world, one browser tab,
trust-everyone API) and a game real people can play end-to-end. Written
June 2026, when sim + core UI + event-sourced persistence were solid
(SIM 0.13.0).

The ordering principle: **each phase ends in something playable by more
people than the last.** No phase is "infrastructure only."

---

## Where we actually are

| Layer | State |
|---|---|
| Sim | Complete for core rules: outposts, subs, combat, specialists, mining/victory, shields/sonar/fog, time machine, chat, gifts, captives. Deterministic, 420 tests. Missing: Contracts + Drowned Queen (designed in doc 21, not built). |
| Server | Single hardcoded game (id 1). Event log is source of truth; replay + epoch baselines work. **No identity at all** — every endpoint trusts `ownerId` in the request body. |
| Client | Full in-game UI, mobile-friendly, but it boots straight into game 1 as player A with a dev player-switcher. No menu, no routing, nothing outside the map screen. |
| Ops | `pnpm dev` on a laptop. No deploy, no TLS, no monitoring. |

The honest framing: **we have a game engine and a cockpit. We are missing
the building around it** — doors, identity, the concept of "a match
among many," and the async-notification loop a 7-day game lives or dies
by.

---

## Phase A — "Play a real match with friends" (foundation)

Goal: I can send three friends a link; we each play on our own phone
under our own name; the game runs days; somebody wins; the result shows.

### A1. Identity (minimum viable, not enterprise)
- **Guest-first accounts**: hitting the site creates a signed anonymous
  identity (cookie + server-side `users` row). Playing never requires a
  form. Display name prompt on first join.
- **Upgrade path**: attach email (magic-link) so the account survives
  device loss. OAuth can wait.
- **Sessions**: httpOnly cookie carrying a session token; WS upgrades
  authenticate the same way.
- **Kill `ownerId` in bodies**: server derives the acting player from
  the session's seat in that game. The dev player-switcher stays, but
  behind a `DEV_MODE` flag.
- Schema: `users`, `sessions`, `game_seats(game_id, seat, user_id)`.

### A2. Many games, one server
- `main.ts` currently hosts game 1; the `games` table already supports
  more. Introduce a **GameHost registry**: load-on-demand, tick all
  active games in one loop, suspend finished/idle ones.
- Routes gain `gameId` (path param), WS subscribes per game.
- Per-game config persisted at creation: player count (2–10), map seed,
  **game speed** (1× the real async game; faster presets for testing
  and "blitz" matches).

### A3. Lobby + invite flow
- **Create game** → config → shareable invite link (`/g/<code>`).
- Joining claims a seat (guest identity auto-created). Game **starts
  when full** (or host force-starts with bots/empty seats dropped —
  see D3 for bots; until then, full-start only).
- Pre-start lobby screen: who's in, config summary, leave/kick.

### A4. Client shell (menu around the cockpit)
- Real routing (`/` home, `/g/:code` lobby/game, `/profile`).
- **Home**: "your games" list (turn-state at a glance: under attack /
  arrivals soon / unread chat), create game, join by code.
- **Game end**: victory/elimination ceremony screen + final standings;
  the finished game stays open read-only (event log makes this nearly
  free — it's a replay at `t = end`).
- Profile: name, color preference, basic record (games, wins).

**Exit criteria**: 4 phones, 4 accounts, one full game start→victory
with zero shared secrets and zero dev tooling.

---

## Phase B — "The game survives being asynchronous" (retention loop)

A 7-day game is lost the moment players forget it exists. This phase is
not optional polish — for this genre it is the core product.

### B1. Push notifications (the heartbeat)
- **Web Push** (service worker) for: incoming attack detected on sonar,
  combat resolved, outpost lost/gained, queen threatened, DM received,
  game started / game ended, "your sub arrives in 1h" digest.
- Per-event toggles in settings; quiet hours; batching (one push per
  ~15 min per game max — the original game's pain was both too few AND
  too many pings).
- Email fallback for accounts with attached email (daily digest).

### B2. PWA packaging
- Manifest (icons exist already), service worker, installable on
  iOS/Android home screen, offline shell that shows cached last-known
  game state with a "reconnecting" banner.
- This is the app-store story for v1. Capacitor wrappers are a later,
  separate decision (D5).

### B3. Async-life mechanics
- **Resign** (with confirm + cooldown) and **abandon detection**
  (no login for N days → queen goes dormant per docs/10 elimination
  rules, notify the table).
- **Vacation/pause** votes? Defer — note as open design question.
- Eliminated-player experience: spectate + chat (read or full? doc 21's
  Drowned Queen answers this properly in Phase D).

**Exit criteria**: a 7-day 1× game where nobody has the tab open and
everyone still makes their moves because the phone told them to.

---

## Phase C — "Strangers can play" (matchmaking + trust)

### C1. Matchmaking
- Public game list (open seats, config, host) — the simplest
  matchmaker that works for low population. A queue-based matcher
  ("find me a 7-player 1× game") layered on top once concurrent
  population justifies it.
- **Rating**: Glicko-2 per player, updated at game end (multiplayer →
  treat as pairwise vs. each opponent weighted by finish order).
  Unrated flag for casual games.

### C2. Abuse + moderation (the original game's documented killer)
- Multi-accounting resistance: one rated seat per verified identity
  per game; new-account rate limits; same-IP/device heuristics flag
  (not auto-ban) for review.
- Block/report users; report attaches the game's chat log (we already
  store it).
- Code-of-conduct page (docs/09 has the policy text).

### C3. Production ops
- Deploy story: single Docker image (server + built client), SQLite on
  a persistent volume + litestream/backup, reverse proxy with TLS/WSS,
  health checks (exists), structured logs (pino — exists) shipped
  somewhere, error reporting (client + server), nightly DB snapshot.
- CI: GitHub Actions running typecheck/lint/test on PR (cheap, do in
  Phase A actually — listed here, executed first).
- Load reality check: one node process comfortably ticks hundreds of
  500ms-tick games (each tick is sub-ms); the WS fan-out per game is
  the cost to watch. Measure before sharding; don't build sharding
  speculatively.

---

## Phase D — "Deep, alive, polished" (the game becomes itself)

### D1. Contracts (doc 21 §3) — the funding replacement
Escrowed Neptunium bounties on enemy outposts. Sim + UI per the
committed design. This is the highest-value mechanic on the shelf.

### D2. The Drowned Queen (doc 21 §4)
Eliminated players haunt as ghost queens. Solves the "eliminated = gone"
problem B3 papers over.

### D3. Bots
Even dumb bots matter: fill abandoned seats (replace, not pause, a
resigned player), let new players do a solo practice game, and serve as
load-test agents. Start with a scripted "turtle + opportunist" policy
on the sim API; no ML.

### D4. Onboarding
- Interactive tutorial as a scripted solo game (the sim's determinism
  makes a guided script trivial to author).
- The drag-hints exist; grow them into a first-game checklist.

### D5. Polish backlog
- Sound design (sonar pings, launch, combat, chat).
- Replay viewer for finished games (event log already supports it —
  this is UI work only: a scrubber across the whole match).
- Match history + per-game stats page; profile becomes interesting.
- Native wrappers (Capacitor) if PWA distribution proves limiting.
- Localization scaffolding (defer actual translations).

---

## Sequencing summary

```
A. identity → multi-game → lobby/invites → client shell → end screen   [foundation]
B. web push → PWA → resign/abandon                                     [async loop]
C. public games → rating → moderation → deploy/CI(early)               [strangers]
D. contracts → drowned queen → bots → tutorial → sound/replays         [depth]
```

Two things deliberately NOT planned: native app stores before PWA
proves the loop, and any server sharding before measurement says so.

## Open design questions (decide when their phase starts)

1. Guest accounts in rated games — allowed, or email-verified only? (C1)
2. Force-start with empty seats vs. bot-filled seats. (A3/D3)
3. Eliminated-player chat: read-only or full voice until Drowned Queen
   ships? (B3)
4. Game speed presets for ranked: 1× only, or is 4× "blitz" rated? (C1)
5. Pause/vacation votes — worth the griefing surface? (B3)
