# Submarines (Subs)

A sub is the only mobile entity in Subterfuge. Every movement of every
driller and every specialist happens by sub. Outposts produce; subs
transport. Without a sub, nothing leaves an outpost.

This file documents how subs are launched, how they move, what they
carry, how they are tracked, how they reach their target, and what
happens when they arrive.

## What a Sub Is

A sub is a transport vessel with three pieces of cargo state:

- **Drillers**: an integer count, from 1 upward.
- **Specialists**: zero or more specialist units aboard.
- **Gift flag**: a boolean indicating whether the sub is being given to
  another player (see Gifts below).

A sub exists in the simulation only while it is in flight. It has no
persistent identity at an outpost: when a sub arrives, its drillers and
specialists merge into the destination outpost (if friendly) or fight
the garrison (if hostile), and the sub object is destroyed.

## Launching a Sub

A launch order has three parameters:

1. **Source outpost** (must be owned by the player).
2. **Destination outpost** (any outpost on the map within sonar or that
   the player has previously seen — including dormants and enemy outposts).
3. **Cargo** (number of drillers and which specialists from the source).

Once the launch order is issued the sub enters a **10-minute pre-launch
window** at the source outpost. During this window:

- The player may change the driller count.
- The player may add/remove specialists.
- The player may cancel the launch outright.

After 10 minutes the sub physically departs. The pre-launch window is the
only time a launch order can be undone (with one exception, the Navigator,
which lets the sub be re-routed mid-flight).

### Why a 10-minute window?

This is a design concession to the game's slow real-time nature: it gives
the player time to react to a misclick, fix the cargo, or pull the launch
if they change their mind. Once the sub launches it is on a fixed
deterministic trajectory.

## Sub Cargo

There is **no fixed maximum** number of drillers per sub. A sub can carry
any number from 1 up to the entire driller stockpile at the source. The
player simply picks a value with the slider in the UI.

A sub can also carry specialists. The rulebook does not state a hard
specialist cap, though community observations cap practical movement of
released captives at around 3. There is no enforced limit in the rules
themselves — multiple offensive/defensive specialists may share a sub.

If a sub arrives at a friendly outpost (the player's own, or a gift
target's outpost), all cargo merges into the destination. If it arrives
at a hostile outpost, the cargo participates in combat (see
`04_combat.md`).

## Travel and Speed

Subs travel **in a straight line** from source to destination at a
constant base speed (referred to internally as "1.0×"). The map is a
continuous 2D plane and distance is straight-line Euclidean distance,
so travel time = distance / effective speed.

Sub trips are intentionally slow. The designers cite ~12 hours as a
typical short hop between neighbouring outposts. Distant trips take
days.

### Speed Modifiers

Two distinct mechanisms apply: a **local-max** rule for specialists on
the sub itself, and a separate **Admiral global passive** for subs
with no specialist aboard.

**Local-max rule.** Of all the local speed specialists aboard a given
sub, **only the largest applies**. Multipliers do **not** stack
additively or multiplicatively on the same sub.

| Specialist               | Local Speed                                                |
|--------------------------|------------------------------------------------------------|
| Smuggler                 | ×3 while heading to one of owner's outposts; otherwise ×1 |
| Helmsman                 | ×2                                                         |
| Pirate (chasing target)  | ×2                                                         |
| Pirate (returning home)  | ×4 (after the engagement)                                  |
| Lieutenant               | ×1.5                                                       |
| General (local)          | ×1.5 (retained from Lieutenant)                            |
| Admiral (local)          | ×1.5                                                       |
| Navigator                | — (no speed effect; mid-flight redirect ability)           |
| (no specialist)          | ×1                                                         |

**Admiral global passive.** Each Admiral the player owns adds +50% to
the speed of *every* sub the player owns that carries **no
specialist**: 1 Admiral → ×1.5, 2 → ×2.0, 3 → ×2.5, additive.
This is independent of the local-max rule (the boosted subs have no
local speed specialist by definition).

Notes:

- The sub's `arrivalAt` is recomputed whenever its effective speed
  changes: at launch, after a Saboteur redirect, when Smuggler's
  destination ownership changes, etc.
- Pirate's ×4 home-return only applies *after* the intercept
  resolves; the ×2 applies while chasing.
- Smuggler's ×3 evaporates if the destination is captured by an enemy
  mid-flight (speed drops to ×1 until the destination is recaptured).

See `docs/05_specialists.md` §10 for the full canonical rule.

## Redirecting a Sub Mid-Flight

By default, **once a sub has launched, its destination is locked**. The
player cannot recall or re-target the sub.

The single exception is the **Navigator** specialist (and its promoted
form, **Admiral**, which also has Navigator's ability locally). A sub
carrying a Navigator can be re-targeted at any time during flight. This
is the only mechanic for course changes after launch.

This is a deliberate design choice: it makes the planning and bluff phase
of the game meaningful. An incoming sub that the enemy can see locks the
attacker into a commitment that the defender can respond to.

## Gifting a Sub

Any sub can be flagged as a **gift** to another player. A gift sub:

- Does **not** engage in combat with subs it passes (sub-vs-sub combat is
  skipped for gift subs in both directions).
- On arrival at any outpost owned by the gift target, transfers all
  drillers and specialists to that outpost.
- If the recipient does not own the destination outpost, the gift sub
  still attempts to arrive there but **becomes a normal attack on
  arrival**.
- Can be used to send drillers, specialists (including the Queen!), or
  even captured prisoners to an ally.

Gift subs are a primary diplomatic tool: trustworthy alliances exchange
drillers regularly; a sudden gift to a struggling player is a way to
form an alliance mid-game.

## Sub Visibility

The sub visibility rules are part of the game's central
fog-of-war system:

- The owner of the sub **always sees the sub** wherever it is.
- Other players see the sub **only if it is within sonar range** of one of
  their outposts.
- A sub that leaves the source's sonar range and is not within any other
  outpost's sonar range becomes invisible to everyone except the owner.
- A sub that enters an enemy's sonar range becomes visible to that enemy
  with full cargo information (drillers + specialists).
- A sub passing through a player's sonar range and then leaving it is no
  longer visible — it does **not** stay flagged.

A sub's owner cannot see what is around their sub while it is in transit
unless they have an outpost with sonar covering that area. From the sub's
own perspective, "darkness" surrounds it. This is what makes intercepts
possible.

The position-prediction in the Time Machine is exact: given known orders
and known sub positions, the simulation projects all sub positions
deterministically. The uncertainty is in *which orders other players
have queued*.

## Combat Triggered by a Sub

A sub triggers combat in two situations:

1. **Sub-vs-outpost**: when a hostile sub arrives at an outpost.
2. **Sub-vs-sub** (also called a *mirror-route encounter*): when two
   hostile non-gift subs are travelling between the same pair of
   outposts in opposite directions (Sub A goes X → Y while Sub B goes
   Y → X) and their paths meet while both are still in flight.

The meeting time of a mirror-route encounter is a pure function of the
two subs' launch/arrival times. Let

```
fA  =  A.arrivalAt - A.launchAt        (A's travel duration)
fB  =  B.arrivalAt - B.launchAt        (B's travel duration)

meet = (A.launchAt · fB  +  B.launchAt · fA  +  fA · fB) / (fA + fB)
```

The encounter only fires if `meet` falls inside both subs' active
intervals — i.e. `A.launchAt ≤ meet ≤ A.arrivalAt` and similarly for B
— otherwise one sub arrived before the other launched and they never
actually meet. At equal travel times, `meet` simplifies to the midpoint
of the journey.

**Other geometric crossings do not fight.** If two subs are on
different two-outpost corridors but their paths happen to intersect on
the map, they pass each other untouched. Forcing such an encounter
requires the **Pirate** specialist (which lets the carrier sub target
any visible enemy sub regardless of route).

If either sub in a mirror-route encounter is a gift, no combat occurs.

See `04_combat.md` for the full 4-phase combat resolution (Phase 2,
Shield, is skipped in sub-vs-sub).

## Arrival Resolution

When a sub arrives, the simulation evaluates:

- **Friendly outpost (player owns destination):** drillers and
  specialists merge into the outpost's garrison.
- **Friendly outpost, gift target = destination owner:** drillers and
  specialists transferred to the destination owner.
- **Hostile outpost:** combat resolves; if attacker wins, the outpost
  changes ownership and remaining drillers garrison it.
- **Dormant outpost:** the player claims the outpost; all sub cargo
  garrisons it.

Multiple subs arriving at the same outpost in the same world tick are
all resolved together. Friendly subs all merge; hostile subs from the
same enemy combine forces for one combat; hostile subs from multiple
enemies fight one combat each in order, defender's surviving force from
the previous battle defending the next one.

## What Subs Don't Do

For implementation fidelity, the following are **not** valid sub
behaviours:

- No mid-flight cargo changes after the 10-minute pre-launch window.
- No recalling a sub (Navigator only re-routes; it can't simply turn
  around to source without a destination).
- No carrying neptunium. Neptunium accrues to the player, not to
  outposts or subs.
- No sub fortification, no docking, no fuel.
- No targeting an arbitrary enemy sub without a Pirate. Two ordinary
  subs *do* collide on mirror routes (see Combat above), but you can't
  point a sub at a sub flying a different corridor unless you have a
  Pirate aboard.
- Subs cannot stack mid-ocean; each sub is its own entity until arrival.

## Implementation Notes

For a faithful recreation:

- Store each sub as `{owner, source, dest, departure_time, arrival_time,
  drillers, specialists, gift_flag, modifiers}` where `modifiers` is the
  composed speed multiplier from any specialists aboard.
- Recompute `arrival_time` at any moment a specialist boards or
  disembarks (which, given the rules, only happens at the source during
  the 10-minute window — or never).
- The Navigator's mid-flight re-targeting changes `dest` (and therefore
  `arrival_time`), but the sub's *current position* at re-target time
  becomes its new effective source.
- For deterministic prediction the simulation must compute sub positions
  as functions of time; that is what the Time Machine does.
