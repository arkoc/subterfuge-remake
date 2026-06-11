# Drillers and Production

Drillers are the only military / industrial unit in Subterfuge. Every
attack, every defence, every shield-absorbed attacker, every mine drilled
is paid in drillers. This file documents how drillers are produced, how
they're capped, how they're stored, what they're spent on, and how to
think about driller economy from an implementation standpoint.

## What Drillers Are

Drillers are autonomous underwater mining drones. They are:

- **Fungible**: there is no distinction between one driller and another.
- **Free**: they are produced over time by Factories at no resource cost.
- **Single-use against shields and combat**: in combat, drillers cancel
  drillers 1-for-1 (after shields and specialists apply); they are not
  reusable.
- **Multi-use against drilling**: drilling a mine consumes drillers
  irrecoverably.

There is no separate "soldier" or "miner" unit. The same drillers that
fight wars also dig the mines that win games. This is the heart of the
strategic tension: every driller you commit to attack is one fewer you
can spend on mining.

## Factory Production

A **Factory** produces drillers on a fixed clock:

- **6 drillers every 8 hours**, indefinitely.
- = **18 drillers per day per factory**.
- = **0.75 drillers per hour per factory**.

Production is paid out in discrete 8-hour ticks per factory, not as a
continuous trickle. Each factory has its own production cycle phase —
they do not all tick on the same global clock.

### Specialist Modifiers

Driller production can be increased or decreased by specialists. All
listed effects are *per Factory* unless noted otherwise.

| Specialist             | Effect on Production                                               |
|------------------------|--------------------------------------------------------------------|
| Foreman (local)        | +6 drillers per production cycle at its own Factory                |
| Tycoon (global)        | +50% global production rate (cycles run 50% faster)                |
| Tycoon (local)         | Additionally +3 drillers per cycle at its own Factory              |
| Minister of Energy     | −1 driller per cycle at all your Factories (offsets +300 power)   |
| Engineer (after combat)| Restores 25% of lost drillers globally after winning combat        |

Note that **Tycoon's global effect speeds up the cycle** rather than
multiplying the per-cycle output. A Factory under Tycoon influence
completes one cycle in ~5.33 hours instead of 8.

## Electrical Output (Driller Cap)

A Factory will produce on its scheduled tick **only if the player's total
driller stockpile is below their global electrical output cap**. If the
stockpile is at or above the cap, the tick produces zero drillers and is
forfeited; the next tick is rescheduled normally.

Sources of electrical output:

| Source                    | Contribution                                |
|---------------------------|---------------------------------------------|
| Queen's home outpost      | **+150** base                              |
| Each Generator owned      | **+50** each                                |
| Tinkerer (at an outpost)  | **+3 × that outpost's max shield charge**  |
| Minister of Energy        | **+300 global**                            |
| Security Chief (indirect) | Raises shield charge → boosts Tinkerer     |

A typical player at mid-game has:

- 150 (Queen) + 4 Generators × 50 = **350**.
- This caps the total stockpile at 350 drillers.

When a player exceeds the cap (e.g., by capturing an enemy outpost full
of drillers), Factories stop producing until the stockpile drops below
the cap. The excess drillers are **not** destroyed.

## Storage and Distribution

There is no per-outpost driller cap. Drillers stockpile freely at the
outpost that produced them or to which they were transported. A single
outpost can hold all of a player's drillers if they choose to consolidate.

Drillers move between outposts only by sub. There is no instant
teleportation, even between two friendly outposts a metre apart on the
map.

## Driller Spending

Drillers are spent on:

| Action            | Cost                                                       |
|-------------------|------------------------------------------------------------|
| Combat            | 1 driller per enemy driller they cancel + losses to shields|
| Drilling 1st mine | 50                                                         |
| Drilling 2nd mine | 100                                                        |
| Drilling 3rd mine | 200                                                        |
| Drilling 4th mine | 300                                                        |
| Drilling 5th+ mine| +100 per additional mine ever drilled                      |
| Shield absorption | 1 driller per shield charge consumed                       |

Drilling costs escalate based on **total mines ever drilled** by the
player, not currently owned. Losing a mine does **not** reduce future
costs.

### Engineer Restoration

After a victorious combat, if a player has an **Engineer** specialist
involved (or anywhere globally), **25% of lost drillers (rounded up) are
restored**. This is the only mechanic in the game that "reverses"
combat losses.

## Production Lifecycle (Implementation Sketch)

```
on tick(now):
  for each player p:
    cap = electrical_output(p)
    stockpile = sum(o.drillers for o in p.outposts)
    for each factory f owned by p:
      if now >= f.next_cycle_time:
        produce = 0
        if stockpile < cap:
          produce = 6 + foreman_bonus(f) + tycoon_local_bonus(f)
                      + minister_penalty(p)
          o = f.outpost
          o.drillers += produce
          stockpile += produce
        f.next_cycle_time += 8h / tycoon_global_multiplier(p)
```

The phase of each factory's cycle is independent — they tick at different
moments depending on when they were created or captured. This staggering
is one reason large factory counts feel continuous rather than bursty.

## Combat Driller Math

In combat (full rules in `04_combat.md`), drillers behave like this in
each side's pool:

1. The **Specialist phase** can directly destroy enemy drillers
   (Lieutenant: 5; War Hero: 20; General: 10; King: 1 per 3 friendlies;
   Sentry: 5% rounded up per shot every 2 hours).
2. The **Thief** converts 15% of enemy drillers (rounded up) onto the
   attacker's side (it does not destroy them).
3. In sub-vs-outpost combat, the **Shield phase** subtracts shield
   charge from incoming drillers 1-for-1.
4. In the **Driller phase**, the side with more drillers wins; the
   winner keeps `(winner − loser)` drillers, the loser keeps 0.

Combat is deterministic. There is no randomness in driller arithmetic.

## Generator Loss Implications

When a Generator is converted to a Mine, the player loses 50 electrical
output. This can suddenly push them over the cap (e.g., they had 350
cap and 320 drillers; drilling a Generator drops cap to 300; they now
have 20 over cap and Factories pause).

This is why the conversion is strategic, not free. Players typically
drill Factories rather than Generators, but late-game drilling a
Generator can be the right call when production is no longer the
bottleneck.

## Driller Economy Heuristics

For an implementation that needs to reason about driller economy:

- **Equilibrium**: a player at the cap produces 0 net drillers; their
  spending must match their production.
- **Refill time**: to refill from empty to 350 cap with 5 Factories
  (90 drillers/day) takes about 4 days.
- **Sustainable attack**: a player committing more than ~50% of their
  cap to one attack is at risk of being counter-attacked while bare.
- **Mine ROI**: the first mine pays back its 50 drillers in 50/(N×1)
  days, where N is total outposts. With 7 outposts that's ~7 days —
  approximately the full length of a game. Mining is therefore a
  late-game investment, mostly enabled by being unable to spend
  drillers offensively.

## Common Misconceptions

These are **not** true in Subterfuge — implementation should reject them:

- "Drillers cost money to produce." They cost only the 8-hour wait.
- "Different outposts have different driller types." They don't.
- "A maxed factory can be upgraded." No tech tree, no upgrades.
- "Drillers lose health over time." They don't.
- "Capturing an outpost destroys all its drillers." It doesn't; surviving
  drillers transfer to the new owner.
- "Drillers cap at 999 per outpost." No per-outpost cap; only the global
  electrical cap.
- "A Mine still produces drillers because it used to be a Factory." A
  Mine produces only Neptunium; it lost the Factory's role on
  conversion.

## Summary Numbers Table

| Quantity                              | Value             |
|---------------------------------------|-------------------|
| Base electrical output (Queen)        | 150               |
| Generator output                      | +50               |
| Factory output                        | 6 / 8 h           |
| Starting drillers per non-Queen outpost | 40              |
| 1st mine cost                         | 50 drillers       |
| 2nd mine cost                         | 100 drillers      |
| nth mine cost (n ≥ 3)                 | ≈ n × 100 drillers|
| Engineer post-combat restoration      | 25% of lost       |
| Thief steal rate                      | 15% of enemy      |
| Shield max (weak / strong)            | 10 / 20           |
| Shield recharge time (full)           | 48 h              |
