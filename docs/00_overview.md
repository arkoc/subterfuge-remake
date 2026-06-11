# Subterfuge — Game Overview

> A week-long underwater game of strategy, diplomacy, and subterfuge.

## High-Level Concept

Subterfuge is a real-time strategy game designed by Ron Carmel (co-creator of
*World of Goo*) and Noel Llopis, released for iOS and Android in 2015. The
game is a loose descendant of *Diplomacy* and *Neptune's Pride*, but it is
explicitly designed for mobile devices and for players whose lives are not
organised around being at a screen.

Up to 10 players compete simultaneously in a persistent underwater world.
Instead of turns, the game runs continuously in real time over the course of
roughly **7–10 days**. Orders are issued asynchronously; subs take many real
hours to travel between outposts; resource production happens on a clock that
ticks regardless of whether the player is logged in.

Two design principles dominate every decision in the game:

1. **No twitch play.** Nothing important can be won or lost by reacting in
   under 8–10 hours. This makes the game safe to play across timezones, work
   hours, and sleep.
2. **Depth comes from diplomacy.** The mechanical rules are intentionally
   small and transparent. The interesting decisions emerge from negotiating,
   bluffing, and forming alliances with the other nine human players.

## Victory Conditions

A player wins the game by satisfying **any** of these conditions:

- **Neptunium victory (standard rule).** Accumulate **200 kilos of
  Neptunium** by operating Mines. Neptunium is the silvery element used to
  power *The Apparatus*; collecting 200 kilos completes it and ends the game.
- **Dominion victory (variant rule).** Control a configured number of
  outposts on the map. This is the "domination mode" used in some games.
- **Last player standing.** If every other player has been eliminated, the
  remaining player wins.

A player is **eliminated** when:

- Their **Queen is captured or destroyed** (an opponent takes the outpost the
  Queen is on, and the Queen has not been promoted to Princess via a backup
  Queen).
- The player **resigns** voluntarily.
- The player is **inactive for 48 hours** without any pending orders, which
  triggers automatic resignation.

Eliminated players keep visibility and chat access — they may still
participate in diplomacy and act as kingmakers, but they cannot issue orders.

## Players and Game Setup

- **Player count.** Public games are designed for **10 players**; smaller
  custom games can be configured down to 2.
- **Starting outposts.** Each player begins with **5 outposts**:
  - 4 ordinary outposts, each pre-stocked with **40 drillers**.
  - 1 outpost containing the **Queen** (the player's avatar).
- **Outpost mix.** The 4 ordinary starting outposts are a randomised mix of
  Factories and Generators. The map also contains many **dormant** (neutral,
  unowned) outposts the players can take by simply sending drillers to them.
- **Map shape.** The map is a continuous 2D underwater plane (not a grid),
  wrapping so every player is surrounded by neighbours and no one starts on
  an edge. Outposts are scattered with a relaxation algorithm so distances
  feel even but not uniform. The map generator considers ~500 candidate
  layouts and selects the most balanced.
- **Outpost names.** Outposts are drawn from a pool of ~100 thematic ocean /
  water-myth names (e.g. *Atlantis*, *Mariana*, *Triton*).

## The Eight Core Systems

Subterfuge is built on **8 interlocking systems**. The whole game can be
understood by understanding how each of these systems behaves in isolation
and how it interacts with the others.

1. **Manufacturing** — Factories produce drillers on an 8-hour cycle.
2. **Electrical Output** — A global cap on driller stockpile; raised by
   Generators and the Queen's home outpost.
3. **Shields** — Outpost defences with weak (10) or strong (20) max charge,
   recharging over 48 hours.
4. **Subs** — Submarines launched from outposts to transport drillers and
   specialists; subject to a 10-minute pre-launch window before they leave.
5. **Combat** — A deterministic 4-phase resolution that produces zero random
   outcomes; everything is predictable given the inputs.
6. **Mining** — Conversion of Factories or Generators into Mines that
   produce Neptunium; drilling cost escalates with each mine drilled.
7. **Visibility (Sonar)** — Fog of war; each outpost has a sonar radius that
   exposes subs and outposts within it.
8. **Specialists** — Hero-like characters hired by the Queen every 18 hours;
   each modifies one of the other seven systems in some way.

Each of these systems is documented in its own file under this directory.

## Time, Speed, and "Real-Time" Cadence

- The game's clock runs in real wall-clock time.
- A typical sub takes around **12 hours** to reach a nearby outpost. Far
  outposts can take days.
- One Factory cycle is **8 hours**; one Mine cycle is **24 hours** (1 kilo of
  Neptunium per day per Mine per outpost owned).
- A specialist offer rotates every **18 hours** (after an initial 4-hour
  wait).
- A player who goes silent is auto-resigned after **48 hours**.
- All durations above are exact and visible to the player — the game does
  all the prediction math for them.

The **Time Machine** is the mechanic that turns this from "a game you must
watch" into "a game you can pre-program." Players can scrub the clock
forward to any future moment, see a deterministic prediction of the
battlefield at that moment, and queue orders that will execute when the
clock arrives there. See `08_time_machine.md` for details.

## Diplomacy and Communication

- The only player-to-player communication channel is **in-game text
  messaging**. There is no voice, no video, no image sharing.
- Players can form alliances, share intel, gift specialists, gift drillers,
  promise non-aggression — and break every one of those promises.
- The 12-hour sub travel time is deliberately long to make diplomacy a
  meaningful counter to military action; players can negotiate while a sub
  is still inbound and frequently do.
- The code of conduct prohibits **multiboxing** (controlling multiple
  accounts), **excessive gifting** to allies (effectively two-headed
  players), **pre-made alliances** entering public games, and abusive
  behaviour. Soft alliances are not only legal, they are expected.

## Funding (In-Game Economy of Kindness)

Late in the game, a player who is **20 or more kilos ahead** of another in
Neptunium could historically **fund** them. > **Removed (June 2026):** the funding mechanic was deleted — it amplified leader coalitions instead of helping trailing players. See [docs/21](./21_contracts_and_drowned_queen_plan.md) for the replacement design (The Undertow).

- **+50 to electrical output** (effectively a free Generator).
- **+2 drillers per cycle per Factory**.

This mechanic exists to redistribute power from the leader to challengers,
giving leaders a tool for buying allies in the final stretch of the game.

## What the Game Avoids

To preserve its design pillars, Subterfuge deliberately excludes:

- Random combat outcomes. Combat is deterministic.
- Resource scarcity beyond Neptunium. Drillers, the universal military
  resource, regenerate freely.
- Tech trees, building queues, base layouts, formations, or research.
- Anything that would reward players for being online more.
- Mechanics that require checking in faster than every 8–10 hours.

## How To Read These Docs

The files in this directory are written to be self-contained — each one
explains a single system end-to-end so that an implementer can produce that
system without cross-referencing every other file. Where systems interact
(e.g. how Specialists modify Combat) the interaction is documented in both
files.

Read order, if learning the game from scratch:

1. `00_overview.md` (this file)
2. `01_outposts.md`
3. `02_subs.md`
4. `03_drillers_production.md`
5. `04_combat.md`
6. `05_specialists.md`
7. `06_mining_neptunium.md`
8. `07_shields_sonar_visibility.md`
9. `08_time_machine.md`
10. `09_diplomacy_and_communication.md`
11. `10_game_flow_and_lifecycle.md`
