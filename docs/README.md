# Subterfuge — Game Mechanics Documentation

A detailed reference for recreating the 2015 mobile real-time strategy
game **Subterfuge** (by Ron Carmel and Noel Llopis). Each file in this
directory documents a single subsystem of the game from rules through
implementation notes, with the goal of being detailed enough that an
implementer can build the subsystem from the file alone.

## Reading Order

1. [`00_overview.md`](00_overview.md) — high-level game concept,
   victory conditions, design pillars, and the eight core systems.
2. [`01_outposts.md`](01_outposts.md) — the three outpost types
   (Factory, Generator, Mine), starting layout, shields, sonar,
   capture, conversion.
3. [`02_subs.md`](02_subs.md) — launching subs, cargo, travel,
   speed modifiers, redirection, gifts, arrival.
4. [`03_drillers_production.md`](03_drillers_production.md) — the
   driller production economy, electrical output cap, specialist
   modifiers, lifecycle.
5. [`04_combat.md`](04_combat.md) — the deterministic 4-phase combat
   resolution algorithm; sub-vs-outpost and sub-vs-sub edge cases.
6. [`05_specialists.md`](05_specialists.md) — every specialist's
   ability, combat priority, promotion path, and counters.
7. [`06_mining_neptunium.md`](06_mining_neptunium.md) — how mines
   are drilled, the Neptunium formula, the 20% capture penalty,
   victory condition.
8. [`07_shields_sonar_visibility.md`](07_shields_sonar_visibility.md)
   — shield charge and recharge; sonar range; fog of war; global mine
   visibility.
9. [`08_time_machine.md`](08_time_machine.md) — the deterministic
   future projection / order queue.
10. [`09_diplomacy_and_communication.md`](09_diplomacy_and_communication.md)
    — chat, gift subs, captives, code of conduct. (Funding removed — see docs/21.)
11. [`10_game_flow_and_lifecycle.md`](10_game_flow_and_lifecycle.md)
    — match config, map generation, game phases, elimination,
    end-of-game state.
12. [`11_caching_and_performance.md`](11_caching_and_performance.md)
    — every cache and memoisation in the codebase + invalidation
    rules. Read this before adding features that touch hot paths.
13. [`12_ui_reference.md`](12_ui_reference.md) — complete catalogue
    of UI regions, sheets, interactions, and a 28-step manual /
    automated test checklist.

## Quick Reference

| Quantity                          | Value                          |
|-----------------------------------|--------------------------------|
| Players per game                  | 2–10 (typically 10)            |
| Game length                       | ~7 days real-time              |
| Starting outposts per player      | 5 (4 standard + 1 Queen)       |
| Starting drillers per outpost     | 40 (× 4 outposts = 160)        |
| Factory production                | 6 drillers / 8 hours           |
| Generator electrical output       | +50 each                       |
| Queen base electrical output      | +150                           |
| Weak shield max                   | 10                             |
| Strong shield max                 | 20                             |
| Shield recharge                   | full in 48 hours               |
| Sub launch delay                  | 10 minutes                     |
| First specialist hire             | 4 hours after game start       |
| Subsequent specialist hire        | every 18 hours                 |
| Mine production                   | 1 kg/day × outposts owned      |
| Drill cost (1st / 2nd / 3rd / 4th / 5th) | 50 / 100 / 200 / 300 / 400 |
| Mine capture penalty              | 20% of Neptunium (ceil)        |
| Funding lead requirement          | 20 kg ahead                    |
| Funding bonus                     | +50 power, +2 drillers/cycle   |
| Inactivity auto-resign            | 48 hours                       |
| Time Machine slots                | unlimited                      |
| Neptunium victory threshold       | 200 kg                         |

## Sources

Documentation synthesised from:

- Official Subterfuge Rulebook
  (https://play.subterfuge-game.com/docs/Rulebook/)
- Official Rulebook — Specialists page
  (https://play.subterfuge-game.com/docs/Rulebook/Specialists.html)
- Subterfuge official site (https://subterfuge-game.com/)
- Wikipedia — *Subterfuge (video game)*
- Subterfuge Game Wikia (Fandom): Rules, Combat Resolution,
  Specialists, individual specialist and outpost pages
- Game Developer articles by the developers (Ron Carmel) on design
  philosophy
- TouchArcade preview and review (2015)
- Subterfuge community forums (forums.subterfuge-game.com)
- Designer blog at blog.subterfuge-game.com

## Things That Are *Not* in Subterfuge

To save implementers from chasing phantoms — these features sometimes
get conflated with Subterfuge but **do not exist** in the original
game:

- No tech tree, research, or building upgrades.
- No Lab, Warp Gate, Hospital, or any outpost type beyond Factory /
  Generator / Mine.
- No per-outpost driller cap (only the global electrical cap).
- No randomised combat — all combat is deterministic.
- No specialist that directly boosts Neptunium output (only
  driller / outpost / shield specialists exist).
- No mechanical alliances or shared sonar (everything is by chat
  + gift subs).
- No game-speed multiplier in standard public games.
- No vacation mode beyond the Time Machine + 48-hour timeout.
- No formations, garrison layouts, or attack stances.
- No multi-mode subs (every sub is the same; specialists modify
  it).
- No specialists named Theologian, Industrialist, Scientist,
  Revolutionary, Toxicologist, Wraith, Provocateur, or Reaver
  (these are from other games).
