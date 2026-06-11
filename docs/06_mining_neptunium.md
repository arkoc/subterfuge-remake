# Mining and Neptunium

Neptunium is the win-condition resource in Subterfuge. To win a
standard game a player must accumulate **200 kg of Neptunium** through
their network of Mines. This file documents how Mines are created, how
they produce Neptunium, what happens when one changes hands, and how
the mining race shapes the second half of a game.

## What Neptunium Is

Neptunium is a fictional silvery metal needed to complete *The
Apparatus*, the macguffin in the game's lore. Mechanically it is a
single, global per-player number — there are no Neptunium stockpiles
per outpost, no transport cost, and no storage limit. Every kilo a
player has mined goes into one running total.

When that total hits **200**, the game ends and the player wins.

## Mines Are Made, Not Found

Mines do **not** exist on the map at game start. The map has only
**Factories**, **Generators**, and dormant outposts of those types.
Mines come into existence only through the **drilling** action.

To drill a mine:

1. The player issues a `Drill` order on a Factory or Generator they
   own.
2. The order requires a specific number of drillers to be present at
   that outpost (see Drill Cost below).
3. On resolution, the drillers are **consumed irrecoverably**, the
   outpost converts permanently into a Mine, and the conversion is
   irreversible.

The Queen's home outpost cannot be drilled.

Drilling is **instant** once the order resolves — there is no
multi-hour drilling animation. The cost is the drillers and the
opportunity cost of the lost Factory/Generator role.

## Drill Cost

The cost to drill a mine escalates based on the **total number of
mines the player has ever drilled**, not the number currently owned.
Losing a mine does **not** reduce future cost.

| Mine # ever drilled | Driller cost |
|---------------------|--------------|
| 1st                 | 50           |
| 2nd                 | 100          |
| 3rd                 | 200          |
| 4th                 | 300          |
| 5th                 | 400          |
| 6th                 | 500          |
| nth (n ≥ 1)         | n × 100 (with the first being 50)|

The escalation makes 4–5 mines a typical practical ceiling for a
player; the 6th mine would cost 500 drillers, more than most players
can stockpile.

## Neptunium Production

A single Mine produces:

```
1 kg of Neptunium per day  ×  number of outposts the player owns
```

Worked examples:

- 1 mine, 5 outposts: 5 kg/day total (all from that mine).
- 2 mines, 7 outposts: 2 × 7 = 14 kg/day.
- 3 mines, 10 outposts: 3 × 10 = 30 kg/day.

Notes:

- The multiplier is **total outposts**, not non-mine outposts. Mines
  count toward their own multiplier.
- Losing an outpost (mine or otherwise) reduces the multiplier
  immediately and so reduces every Mine's output.
- Output is paid in small discrete ticks throughout the day rather
  than as one daily lump. The player's Neptunium total updates
  continuously in the UI.

This formula creates a powerful feedback loop: each Mine increases
output by `1 × outposts_owned`, but each additional **outpost**
captured multiplies the output of *all* mines. Late-game expansion is
therefore exponentially valuable for a mining leader.

## The 20% Loss on Capture

When a Mine is captured by an enemy:

- The previous owner **loses 20% of their current Neptunium total**
  (rounded up). This is taken from the player's running total
  immediately on capture.
- The mine's per-tick production timer **resets** for the new owner.
- The new owner now owns the mine and starts producing from it on the
  formula `1 kg/day × their_outpost_count`.

The 20% loss applies only on **capture by another player**. If the
mine is destroyed by a **Martyr** (which ends ownership entirely
because the outpost is destroyed), the penalty does **not** apply.

This rule changes late-game dynamics dramatically. A leader at 180 kg
with three mines is hugely vulnerable to a coordinated strike against
one mine: losing it sets them back to 144 kg (180 × 0.8), bringing
them back into striking range of the pack.

## Specialists That Affect Mining

There is **no specialist that directly boosts Neptunium output**. The
mining formula is sacrosanct. However, several specialists affect the
**drillers** that feed mining or the **outposts** that multiply mining:

| Specialist             | Mining-Adjacent Effect                          |
|------------------------|--------------------------------------------------|
| Foreman                | +6 drillers per Factory cycle (more to drill)   |
| Tycoon                 | +50% global production rate                      |
| Minister of Energy     | +300 electrical output (bigger driller pool)    |
| Thief                  | Steals enemy drillers during combat              |
| Engineer               | Restores 25% of lost drillers after a victory   |
| Intelligence Officer   | +25% sonar, helps locate mines worth attacking  |
| Princess               | +50% sonar at her outpost, useful for mine prot |
| Inspector / Security C.| Stronger shields → harder to lose your mines    |

Indirectly, **anything that increases drillers or protects outposts**
increases mining throughput.

## Mine Visibility

Mines are **globally visible** on the map. Every player sees every
mine's location and owner, regardless of sonar. The garrison defending
a mine, the shield charge, and any specialists at the mine remain
hidden unless within sonar.

This is a deliberate design choice: mines are the win condition, so
players must always be able to see where the race is going. Hidden
mines would make the meta-game incomprehensible.

## The Mining Race

A typical game arc:

1. **Days 1–2**: expansion. Players grab dormants, build up driller
   stockpiles, and avoid drilling early because every Factory drilled
   reduces production for the rest of the game.
2. **Days 2–4**: first mines. Players drill their first mine (50
   drillers) and begin scoring Neptunium. The first mine pays back its
   driller cost in only a couple of in-game days, given enough
   outposts.
3. **Days 4–6**: second and third mines, plus diplomatic
   manoeuvering. Leaders are obvious; coalitions form against the
   front-runner.
4. **Days 6–7+**: the endgame. The leader is racing toward 200 kg
   while everyone else races to capture or destroy at least one of
   the leader's mines (knocking 20% off). A successful capture by
   the trailing pack can flip the leaderboard overnight.

## Domination Variant (Mines Disabled)

There is an alternate game mode — **Domination** — in which:

- Mines are **disabled entirely** (the Drill action is not available).
- Neptunium does not exist.
- Victory is won by **controlling a target number of outposts**, scaled
  to player count (commonly 30–50% of the map's outposts).

Domination removes the slow race of mining and replaces it with
all-out conquest. The other 7 systems remain identical.

## Funding

When a player is **20 or more kilos of Neptunium ahead** of another
player, they could historically fund the trailing player.

> **Removed (June 2026):** the funding mechanic was deleted — it amplified leader coalitions instead of helping trailing players. See [docs/21](./21_contracts_and_drowned_queen_plan.md) for the replacement design (The Undertow).

## Worked Example — A Mining Plan

A player has 7 outposts (3 Factories, 3 Generators, 1 Queen). They
want to drill 3 mines.

- Drill mine 1: 50 drillers consumed → outpost converts. Now 6
  outposts of original types + 1 mine. Production: 1 × 7 = 7 kg/day.
- After ~7 days mining at varying rates this mine has produced ~50
  kg.
- Drill mine 2: 100 drillers consumed → 2 mines, 5 originals.
  Production: 2 × 7 = 14 kg/day.
- Drill mine 3: 200 drillers consumed → 3 mines, 4 originals.
  Production: 3 × 7 = 21 kg/day.

If the player can sustain this, they reach 200 kg in roughly 5–6 days
of full operation — barring capture, war, or shield destruction.

## Implementation Notes

For implementers building the mining subsystem:

- Store `mines_ever_drilled` per player; use this to compute drill
  cost. Decrement only on cheating or admin override — never on mine
  loss.
- Store `neptunium` per player as a floating-point or fixed-point
  number, updated continuously by the tick loop.
- On every tick, for each player p:
  `p.neptunium += dt * mines_owned(p) * total_outposts(p) / 86400`
- On mine capture: `loser.neptunium *= 0.8`, ceil any fractional kilo.
- On mine destruction by Martyr: do not apply the 20% penalty.
- On any player's neptunium ≥ 200: game ends, that player wins.

## What Mining Is NOT

- Mining is **not** a multi-hour drilling animation. Drilling is
  instant.
- Mines do **not** produce drillers. They lose the Factory role on
  conversion.
- Mines do **not** stack — drilling at a Factory that's already a Mine
  is invalid.
- There is **no "rebel" mechanic** for contested mines. Contesting a
  mine means capturing the outpost in normal combat.
- There is **no map-resource pool** of Neptunium that runs out.
  Mining is a function of time × outposts × mines, unbounded by any
  external supply.
- There is **no Mining specialist** that boosts kg/day directly.
